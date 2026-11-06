# Komorebi Practice in Context — Grammar Coverage Checklist

- **Tracking Granularity**: Tracked by `(renshuuGrammarId, meaningIndex)` (`renshuu:<id>#<idx>`) because a single Renshuu grammar ID can cover multiple distinct meanings/uses (e.g., `113` `に` has 9 uses; `132` `の` has 6 uses).
- **Taught Rule**: A grammar meaning is counted as `taught: true` **only** when it has validated primary and distinct follow-up exercises testing it in a pack.
- **Status Lifecycle**: `planned` → `draft` → `validated` → `reviewed` → `live`.
- **Source & Licensing Policy**: The local Renshuu exports are used strictly as a local planning reference. All published explanations, example sentences, glosses, distractors, follow-ups, and worked examples in `data/context-pack-*.json` are original material authored for Komorebi. Raw exports are never uploaded.

## Summary

- **Total JLPT N5 Grammar IDs**: 69
- **Total JLPT N5 Distinct Meanings Tracked**: 147
- **Distinct Patterns Taught Across Packs 1–7**: 21 patterns (42 primary questions + 42 fresh follow-up questions)
- **Renshuu N5 Meanings Taught (`taught: true`)**: 25 (`live`: 16, `reviewed`: 0, `validated`: 9, `planned`: 122)
- **Flagged Items Requiring Review / Disambiguation**: 11

## Active & Validated Beginner Packs (Packs 1–7)

| Pack ID | Title | Subtitle | Status | Patterns (`grammar:*`) | Renshuu Meanings Taught | Questions |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `pack:beginner-1` | Beginner Pack 1 | Foundational Copula, Noun Modification & Inanimate Existence | `live` | `grammar:wa-desu`, `grammar:no-modifier`, `grammar:ni-ga-arimasu` | `renshuu:735#1`, `renshuu:132#2`, `renshuu:132#4`, `renshuu:737#1`, `renshuu:718#1`, `renshuu:113#1` | 6 primary + 6 follow-up |
| `pack:beginner-2` | Beginner Pack 2 | Questions, Shared Topics & Requests | `live` | `grammar:ka-question`, `grammar:mo-also`, `grammar:wo-kudasai` | `renshuu:37#3`, `renshuu:741#1`, `renshuu:117#2`, `renshuu:333#1` | 6 primary + 6 follow-up |
| `pack:beginner-3` | Beginner Pack 3 | Living Beings, Joining Nouns & Past Facts | `live` | `grammar:ni-ga-imasu`, `grammar:to-and`, `grammar:deshita-past` | `renshuu:719#1`, `renshuu:110#2`, `renshuu:743#1` | 6 primary + 6 follow-up |
| `pack:beginner-4` | Beginner Pack 4 | Everyday Actions — Destination, Direct Object & Polite Verbs | `live` | `grammar:ni-destination`, `grammar:wo-object`, `grammar:masu-polite` | `renshuu:112#1` | で | `validated` | LOCATION_CONTRAST_NOTE: で marks where an active conduct takes place, distinct from に which marks static presence (113#1) or destination (113#2). |
| `renshuu:462#1` | が | `validated` | DISAMBIGUATION_FROM_SUBJECT_GA: Conjunctive が joins clauses with 'but', distinct from case particle が (462#2) which marks grammatical subject. |
| `renshuu:467#1` | から~迄まで | `validated` | COMPOUND_PATTERN_NOTE: Bundles starting point から (99#2) and endpoint まで (115#1) into a single span expression across time or space. |
| `renshuu:113#2`, `renshuu:114#2`, `renshuu:476#1` | 6 primary + 6 follow-up |
| `pack:beginner-5` | Beginner Pack 5 | Actions, Accompaniment & Movement Origin | `validated` | `grammar:de-action`, `grammar:to-accompaniment`, `grammar:kara-origin` | `renshuu:112#1`, `renshuu:110#3`, `renshuu:99#2` | 6 primary + 6 follow-up |
| `pack:beginner-6` | Beginner Pack 6 | Time Points, Movement Extent & Polite Past Actions | `validated` | `grammar:ni-time`, `grammar:kara-made`, `grammar:mashita-past` | `renshuu:113#3`, `renshuu:467#1`, `renshuu:477#1` | 6 primary + 6 follow-up |
| `pack:beginner-7` | Beginner Pack 7 | Describing Things — Adjectives, Negative Forms & Clause Contrast | `validated` | `grammar:i-adjective`, `grammar:adjective-negative`, `grammar:ga-contrast` | `renshuu:736#1`, `renshuu:738#1`, `renshuu:462#1` | 6 primary + 6 follow-up |

## Flagged Items & Uncertainty Log

| Meaning ID | Title | Status | Flag / Uncertainty Note |
| :--- | :--- | :--- | :--- |
| `renshuu:113#2` | に | `live` | DISTRACTOR_OVERLAP_GUARD: Particle へ (468#1) can also mark direction/destination with motion verbs, so へ is never used as a distractor against に in grammar:ni-destination. |
| `renshuu:462#3` | が | `planned` | REGISTER_WARNING: Renshuu 462#3 ('That A — negative, abusive') is derogatory/register-sensitive and unsuitable for beginner family practice. |
| `renshuu:468#1` | へ | `planned` | OVERLAP_WITH_113_2: Direction particle へ overlaps with destination に (113#2) on motion verbs like 入る/行く. Do not test へ vs. に in multiple-choice without a dedicated contrast note. |
| `renshuu:470#1` | わ | `planned` | GENDERED_SPEECH_REVIEW: Renshuu 470#1 (sentence-final わ) carries gendered/dialectal nuances and needs native Japanese review before designing beginner exercises. |
| `renshuu:737#1` | AのB | `live` | DUPLICATE_RENSHUU_ID: Renshuu 737#1 (AのB) duplicates 132#2 and 132#4 (の). Both are mapped to grammar:no-modifier in pack:beginner-1. |
| `renshuu:741#1` | Questions | `live` | DUPLICATE_RENSHUU_ID: Renshuu 741#1 (Turns sentence A into a yes/no question) duplicates 37#3 (sentence-final か). Both are mapped to grammar:ka-question in pack:beginner-2. |
| `renshuu:743#1` | でした/ではありませんでした | `live` | PARTIAL_MEANING_SPLIT: Renshuu 743 bundles affirmative でした (743#1, taught in pack:beginner-3) and negative ではありませんでした (743#2, kept planned for a later pack). |
| `renshuu:743#2` | でした/ではありませんでした | `planned` | SPLIT_FROM_743_1: Polite past negative (ではありませんでした / じゃありませんでした) is deferred so Pack 3 focuses cleanly on affirmative でした (743#1). |

## Full N5 Grammar Meaning Checklist (147 Meanings)

| Meaning ID | Title | Meaning / Use | Prerequisites | Linked Komorebi Words | Pack ID | Pattern ID |Exercises | Taught | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `renshuu:5#1` | たい | Want to A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:6#1` | 乍ながら | While A , B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:13#1` | 成なる | To become A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:15#1` | てから | After doing A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:16#1` | て居いる | Describes a state after the action A takes place. | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:16#2` | て居いる | A -ing (Progressive tense) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:16#3` | て居いる | A is the subject's habitual/customary actions. | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:17#1` | てある | Describes a state after the action A takes place. | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:18#1` | てもいい | It is alright to A ; the subject may A ; it's alright if A (condition) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:23#1` | たりたりする | Do things like A and B ; states/conditions like A and B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:37#1` | か | A is a question within the sentence | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:37#2` | か | Some A ; Any A (somebody, somewhere, sometime, somehow, etc.) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:37#3` | か | Forms the question form of the sentence A | `renshuu:735#1`, `renshuu:132#4` | `kanji:山`, `kanji:入`, `kanji:口`, `kanji:人`, `kanji:大` (+5 more) | `pack:beginner-2` | `grammar:ka-question` | 4 (`question:ka-question-1`…) | Yes | `live` |
| `renshuu:37#4` | か | A or B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:47#1` | 前まえに | Before A (occurs/happens), B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:48#1` | 後あとで | After A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:76#1` | より~の方ほうが~ | B is more C than A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:76#2` | より~の方ほうが~ | A is more C than B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:99#1` | から | Because A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:99#2` | から | From A , Since A | `renshuu:735#1` | `vocabulary:山`, `vocabulary:川`, `vocabulary:入り口` (+1 more) | `pack:beginner-5` | `grammar:kara-origin` | 4 (`question:kara-origin-1`…) | Yes | `validated` |
| `renshuu:101#1` | て,で(てform) | Since A ; As A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:101#2` | て,で(てform) | A , then B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:101#3` | て,で(てform) | A and B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:101#4` | て,で(てform) | Do B by means of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:110#1` | と | When/if A , then B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:110#2` | と | A and B (and C ,etc..) | `renshuu:735#1`, `renshuu:718#1`, `renshuu:719#1` | `kanji:山`, `kanji:川`, `kanji:人`, `kanji:大`, `kanji:女` (+5 more) | `pack:beginner-3` | `grammar:to-and` | 4 (`question:to-and-1`…) | Yes | `live` |
| `renshuu:110#3` | と | With A ; to A | `renshuu:735#1` | `vocabulary:人`, `vocabulary:二人`, `vocabulary:女` | `pack:beginner-5` | `grammar:to-accompaniment` | 4 (`question:to-accompaniment-1`…) | Yes | `validated` |
| `renshuu:110#4` | と | Shows a sequence of two events A and B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:110#5` | と | When/if A (polite/formal version) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:112#1` | で | At A ; in A | `renshuu:735#1` | `vocabulary:人`, `vocabulary:大人`, `vocabulary:入り口` | `pack:beginner-5` | `grammar:de-action` | 4 (`question:de-action-1`…) | Yes | `validated` |
| `renshuu:112#2` | で | For A ; in A (shows a length or amount of time) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:112#3` | で | Do B by using the object A ; Do B by means of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:112#4` | で | Shows the material A that something is made of/composed of | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:112#5` | で | Because of A ; Due to A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:112#6` | で | Used after nouns/な-adjectives to link a list of adjectives and/or nouns | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:113#1` | に | In A ; on A ; at A | `renshuu:735#1` | `kanji:入`, `kanji:口`, `kanji:二`, `kanji:三`, `kanji:上` (+6 more) | `pack:beginner-1` | `grammar:ni-ga-arimasu` | 4 (`question:ni-ga-arimasu-1`…) | Yes | `live` |
| `renshuu:113#2` | に | To A ; towards A ; on A | `renshuu:113#1`, `renshuu:718#1` | `kanji:入`, `kanji:口`, `kanji:山`, `kanji:川`, `kanji:人` (+5 more) | `pack:beginner-4` | `grammar:ni-destination` | 4 (`question:ni-destination-1`…) | Yes | `live` |
| `renshuu:113#3` | に | At A (time) | `renshuu:735#1` | `vocabulary:一`, `vocabulary:二`, `vocabulary:三`, `vocabulary:七`, `vocabulary:八` | `pack:beginner-6` | `grammar:ni-time` | 4 (`question:ni-time-1`…) | Yes | `validated` |
| `renshuu:113#4` | に | Used with passive verbs to identify who/what is doing the action | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:113#5` | に | To change into A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:113#6` | に | Every period of time A , B ; Per A , B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:113#7` | に | A and B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:113#8` | に | Going/coming/returning to do A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:113#9` | に | Shows the target/recipient A of the action | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:114#1` | を | Over A ; across A ; along A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:114#2` | を | A is the direct object of a transitive verb | `renshuu:333#1`, `renshuu:113#2` | `kanji:上`, `kanji:下`, `kanji:力`, `kanji:口`, `vocabulary:上げる` (+3 more) | `pack:beginner-4` | `grammar:wo-object` | 4 (`question:wo-object-1`…) | Yes | `live` |
| `renshuu:114#3` | を | Marks place of departure A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:114#4` | を | Shows state A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:114#5` | を | Shows the cause A of the subject's emotions | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:117#1` | も | As many/much as A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:117#2` | も | Also A ; A as well | `renshuu:735#1` | `kanji:人`, `kanji:大`, `kanji:女`, `kanji:山`, `kanji:川` (+6 more) | `pack:beginner-2` | `grammar:mo-also` | 4 (`question:mo-also-1`…) | Yes | `live` |
| `renshuu:117#3` | も | Nothing/no one/nobody ( A ) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:117#4` | も | Even [T], not even A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:117#5` | も | Neither A nor B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:126#1` | という | B is called A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:126#2` | という | All A ; every A ; this (very) A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:126#3` | という | A is information about B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:126#4` | という | It's said that A (hearsay, rumor, report, or legend) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:132#1` | の | Follows A ; turning the sentence into a question (casual). | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:132#2` | の | A 's B (shows possession); the A B | `renshuu:735#1` | `kanji:入`, `kanji:口`, `kanji:山`, `kanji:下`, `vocabulary:入り口` (+2 more) | `pack:beginner-1` | `grammar:no-modifier` | 4 (`question:no-modifier-1`…) | Yes | `live` |
| `renshuu:132#3` | の | The A one | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:132#4` | の | A directly modifies B , B of A | `renshuu:735#1` | `kanji:入`, `kanji:口`, `kanji:山`, `kanji:下`, `vocabulary:入り口` (+2 more) | `pack:beginner-1` | `grammar:no-modifier` | 4 (`question:no-modifier-1`…) | Yes | `live` |
| `renshuu:132#5` | の | B who/that is a(n) A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:132#6` | の | C which/whose A is B . C 's A is B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:224#1` | くらい／ぐらい | So A ; to the extent A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:224#2` | くらい／ぐらい | A non-exact amount A ; Around/about A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:224#3` | くらい／ぐらい | At least A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:328#1` | でしょう | I think A ; Probably A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:328#2` | でしょう | Don't you think A ?; A , right? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:328#3` | でしょう | I wonder if A ; I was wondering if A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:329#1` | に為する | To make A ; To change into A . | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:329#2` | に為する | To choose A (when ordering/choosing) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:330#1` | 時とき | At the time A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:331#1` | が欲ほしい | I want A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:332#1` | て下ください | Please do A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:333#1` | を下ください | Please give me A | `renshuu:718#1` | `kanji:下`, `kanji:一`, `kanji:二`, `kanji:三`, `vocabulary:下さい` (+3 more) | `pack:beginner-2` | `grammar:wo-kudasai` | 4 (`question:wo-kudasai-1`…) | Yes | `live` |
| `renshuu:334#1` | ないで下ください | Please don't do A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:335#1` | をくださいませんか | Please give me A (polite) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:336#1` | て下くださいませんか | Please do A (polite) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:337#1` | ましょう | Let's A (together) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:337#2` | ましょう | Shall I/we A ? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:338#1` | ませんか | Let's A (together, polite); Would you like to A ; Won't you A ? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:341#1` | など,なんて,なんか | Marks the end of the non-exhaustive list A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:341#2` | など,なんて,なんか | Things like A ; for example A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:341#3` | など,なんて,なんか | Used to emphasize negative B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:341#4` | など,なんて,なんか | What (did) A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:341#5` | など,なんて,なんか | What is the name of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:341#6` | など,なんて,なんか | How A ; What A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:341#7` | など,なんて,なんか | Shows a strong emotion or feeling about A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:348#1` | 予よ定ていだ | Plan to A ; Have plans for A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:350#1` | 別べつに~無ない | Not really A ; not particularly A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:353#1` | なあ | Emphasizes feelings or wishes in the preceding sentence A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:354#1` | は初はじめてです | A is the subject's first (time to do something) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:460#1` | 未まだ | A still exists; still doing A ; A is still occuring | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:460#2` | 未まだ | Haven't done A yet | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:461#1` | もう | A has already occurred/been done; A has already started (with ている) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:461#2` | もう | Not A (anymore) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:461#3` | もう | (one, a little, etc.) more A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:462#1` | が | A , but/however B | `renshuu:735#1` | `vocabulary:ふじ山`, `vocabulary:山`, `vocabulary:人`, `vocabulary:大人`, `vocabulary:力` | `pack:beginner-7` | `grammar:ga-contrast` | 4 (`question:ga-contrast-1`…) | Yes | `validated` |
| `renshuu:462#2` | が | Marks the subject A in the sentence | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:462#3` | が | That A (negative, abusive) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:463#1` | 余あまり~無ない | Not very A ; doesn't do A very much (only a little) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:464#1` | 中ちゅう／中じゅう | Throughout A ; all over A ; during the course of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:464#2` | 中ちゅう／中じゅう | During A (period of time); in the middle of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:464#3` | 中ちゅう／中じゅう | Action A is currently ongoing/in the middle of | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:465#1` | 達たち | Marks a group of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:466#1` | 方がた | (Polite) forms the plural of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:467#1` | から~迄まで | From A until B | `renshuu:735#1` | `vocabulary:一`, `vocabulary:三`, `vocabulary:入り口`, `vocabulary:川` | `pack:beginner-6` | `grammar:kara-made` | 4 (`question:kara-made-1`…) | Yes | `validated` |
| `renshuu:468#1` | へ | Go to A ; head to A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:469#1` | や | A and B (shows a non-exhaustive list of items) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:469#2` | や | A or B (small amount) | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:470#1` | わ | (weakly) marks an assertion or intention A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:471#1` | よ | Indicates certainty or emphasis in A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:472#1` | ね | Requests confirmation from the listener about A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:473#1` | だけ | Because of A , (natural results) B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:473#2` | だけ | As much as A can be done; as much as one wants/likes A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:473#3` | だけ | Only A 、Just A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:473#4` | だけ | Do A to some extent, to try A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:473#5` | だけ | Do A as much as possible | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:476#1` | ます/ません | Polite, present form of verb A | `renshuu:113#2`, `renshuu:114#2` | `kanji:入`, `kanji:上`, `kanji:下`, `kanji:人`, `vocabulary:入る` (+4 more) | `pack:beginner-4` | `grammar:masu-polite` | 4 (`question:masu-polite-1`…) | Yes | `live` |
| `renshuu:477#1` | ました/ませんでした | Polite, past form of verb A | `renshuu:735#1` | `vocabulary:入る`, `vocabulary:上げる`, `vocabulary:下げる`, `vocabulary:川` | `pack:beginner-6` | `grammar:mashita-past` | 4 (`question:mashita-past-1`…) | Yes | `validated` |
| `renshuu:478#1` | Present (Non-past) Casual | Casual, present (non-past) positive form of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:478#2` | Present (Non-past) Casual | Casual, present (non-past) negative form of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:479#1` | Past Casual | Casual, past positive form of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:479#2` | Past Casual | Casual, past negative form of A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:503#1` | 一いち番ばん~です | A is the most B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:669#1` | 以い外がい | Other than A ; except for A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:718#1` | が有ある | There is/are A | `renshuu:735#1`, `renshuu:132#4` | `kanji:入`, `kanji:口`, `kanji:二`, `kanji:三`, `kanji:上` (+6 more) | `pack:beginner-1` | `grammar:ni-ga-arimasu` | 4 (`question:ni-ga-arimasu-1`…) | Yes | `live` |
| `renshuu:718#2` | が有ある | A has B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:719#1` | が居いる | There is/are A | `renshuu:718#1`, `renshuu:113#1` | `kanji:人`, `kanji:一`, `kanji:二`, `kanji:三`, `kanji:女` (+9 more) | `pack:beginner-3` | `grammar:ni-ga-imasu` | 4 (`question:ni-ga-imasu-1`…) | Yes | `live` |
| `renshuu:735#1` | AはBです | A is/are B | — | `kanji:山`, `kanji:大`, `kanji:人`, `kanji:入`, `kanji:口` (+6 more) | `pack:beginner-1` | `grammar:wa-desu` | 4 (`question:wa-desu-1`…) | Yes | `live` |
| `renshuu:736#1` | Adjectives | The adjective modifies the noun that directly follows it. | `renshuu:735#1` | `vocabulary:大きい`, `vocabulary:山`, `vocabulary:川`, `vocabulary:ふじ山` | `pack:beginner-7` | `grammar:i-adjective` | 4 (`question:i-adjective-1`…) | Yes | `validated` |
| `renshuu:737#1` | AのB | A 's B (shows possession); B is A | `renshuu:735#1` | `kanji:入`, `kanji:口`, `kanji:山`, `kanji:下`, `vocabulary:入り口` (+2 more) | `pack:beginner-1` | `grammar:no-modifier` | 4 (`question:no-modifier-1`…) | Yes | `live` |
| `renshuu:738#1` | Adjectives-negative | B is not A | `renshuu:735#1` | `vocabulary:大きい`, `vocabulary:山`, `vocabulary:入り口` | `pack:beginner-7` | `grammar:adjective-negative` | 4 (`question:adjective-negative-1`…) | Yes | `validated` |
| `renshuu:739#1` | Adjectives-linking | C is A and B | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:740#1` | 好すき・嫌きらい・欲ほしい | I (don't) like/dislike/want A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:741#1` | Questions | Turns the sentence A into a yes/no question. | `renshuu:735#1` | `kanji:山`, `kanji:入`, `kanji:口`, `kanji:人`, `kanji:大` (+5 more) | `pack:beginner-2` | `grammar:ka-question` | 4 (`question:ka-question-1`…) | Yes | `live` |
| `renshuu:741#2` | Questions | What is A ? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:741#3` | Questions | Where is A ? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:741#4` | Questions | Who is A ? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:741#5` | Questions | What do you like/dislike/want? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:741#6` | Questions | What kind of A do you like/dislike/want? | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:742#1` | 行いく・来くる・帰かえる | (I) go to A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:742#2` | 行いく・来くる・帰かえる | (I) come to A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:742#3` | 行いく・来くる・帰かえる | (I) return to A | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
| `renshuu:743#1` | でした/ではありませんでした | A was/were B . | `renshuu:735#1` | `kanji:人`, `kanji:大`, `kanji:山`, `kanji:入`, `kanji:口` (+5 more) | `pack:beginner-3` | `grammar:deshita-past` | 4 (`question:deshita-past-1`…) | Yes | `live` |
| `renshuu:743#2` | でした/ではありませんでした | A was/were not B / C . | `renshuu:735#1` | — | — | — | 0 | No | `planned` |
