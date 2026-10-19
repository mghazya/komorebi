export function notificationSupport(win = window, nav = navigator) {
  if (!win.isSecureContext || !('serviceWorker' in nav) || !('PushManager' in win) || !('Notification' in win)) return 'This browser does not support push notifications. On iPhone, add Komorebi to your Home Screen and open it there.';
  return '';
}
export function publicKeyBytes(key) {
  const base64 = key.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(base64 + '='.repeat((4-base64.length%4)%4)),c=>c.charCodeAt(0));
}
export function createReviewNotifications({cloud,publicKey,win=window,nav=navigator}) {
  let busy=false;
  const currentUser=()=>cloud.getSession()?.user?.id;
  const sameUser=id=>{if(!id || currentUser()!==id)throw Error('Account changed. Open notification settings again.');};
  const registration=()=>nav.serviceWorker.register('./sw.js',{scope:'./'});
  async function activeRegistration(){
    const reg=await registration();
    if(reg.active)return reg;
    // ready resolves only once there is an active service worker for this page.
    return await nav.serviceWorker.ready;
  }
  async function status(){
    const unsupported=notificationSupport(win,nav);
    if(unsupported)return {message:unsupported,canEnable:false};
    if(!currentUser())return {message:'Sign in to receive reminders for your own reviews.',canEnable:false};
    if(!publicKey)return {message:'Review reminders are coming soon. They are not enabled yet.',canEnable:false};
    if(win.Notification.permission==='denied')return {message:'Notifications are blocked. Allow them in your browser’s site settings to enable reminders.',canEnable:false};
    const id=currentUser(),reg=await activeRegistration(),sub=await reg.pushManager.getSubscription();
    const records=await cloud.listPushSubscriptions();sameUser(id);
    const enabled=Boolean(sub&&records.some(r=>r.endpoint===sub.endpoint));
    return {enabled,canEnable:true,message:enabled?'Reminders are on for this device. At most one alert per hour when reviews are due.':'Get a reminder when reviews are due, even when Komorebi is closed. At most once per hour.'};
  }
  async function enable(){
    if(busy)throw Error('Please wait for the current notification change.');
    const id=currentUser();sameUser(id);
    if(!publicKey)throw Error('Review reminders are not ready yet.');
    busy=true;let created;
    try{
      // Called directly from the user's click, before another await (required on iOS).
      const permission=await win.Notification.requestPermission();
      sameUser(id);if(permission!=='granted')throw Error('Notifications were not allowed. Your study progress is unchanged.');
      const reg=await activeRegistration();sameUser(id);
      let sub=await reg.pushManager.getSubscription();
      if(sub){
        const own=await cloud.listPushSubscriptions();sameUser(id);
        if(own.some(r=>r.endpoint===sub.endpoint))return;
        // A subscription from another account must not be re-used or transferred.
        if(!await sub.unsubscribe())throw Error('Could not clear the previous notification subscription.');
        sub=null;
      }
      created=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKeyBytes(publicKey)});sameUser(id);
      await cloud.registerPushSubscription(created.toJSON());sameUser(id);
    }catch(e){if(created)await created.unsubscribe().catch(()=>{});throw e;}
    finally{busy=false;}
  }
  /**
   * Remove this device's reminder subscription. Never throws. Browser unsubscribe is attempted even
   * if the server row cannot be deleted: an unsubscribed endpoint is rejected by the push service,
   * and the sender prunes rows that return 404/410, so a later learner on this device gets no alerts.
   * Endpoints are only ever removed for the signed-in account (server RPC checks auth.uid()).
   */
  async function cleanup(){
    const result={ok:true,serverRemoved:false,browserUnsubscribed:false,hadSubscription:false,message:''};
    if(typeof nav?.serviceWorker?.getRegistration!=='function')return result; // no service worker API: nothing can be subscribed here
    let sub;
    try{const reg=await nav.serviceWorker.getRegistration('./');sub=await reg?.pushManager?.getSubscription();}
    catch{result.ok=false;result.message='Could not check this browser’s reminder settings. If reminders were on, turn off notifications for this site in your browser settings.';return result;}
    if(!sub)return result;
    result.hadSubscription=true;
    const id=currentUser();
    let serverError=!id,browserError=false;
    if(id){try{await cloud.removePushSubscription(sub.endpoint);result.serverRemoved=true;}catch{serverError=true;}}
    try{result.browserUnsubscribed=Boolean(await sub.unsubscribe());if(!result.browserUnsubscribed)browserError=true;}catch{browserError=true;}
    if(browserError){result.ok=false;result.message='Reminders could not be turned off in this browser. Turn off notifications for this site in your browser settings.';}
    else if(serverError){result.ok=false;result.message='This device will not receive reminders. The server record could not be removed now; it is cleared automatically on the next reminder run.';}
    return result;
  }
  async function disable(){
    sameUser(currentUser());
    const result=await cleanup();
    if(!result.ok)throw Error(result.message);
  }
  /** Sign-out path: cleanup failures are reported, never block signing out. */
  async function cleanupForSignOut(){
    try{return await cleanup();}catch{return {ok:false,message:'Reminder cleanup did not finish. Turn off notifications for this site in your browser settings if needed.'};}
  }
  return {status,enable,disable,cleanupForSignOut};
}
