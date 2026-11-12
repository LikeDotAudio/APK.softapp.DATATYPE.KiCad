# Smoke test — DATATYPE.KiCad

Is `DATATYPE.KiCad` deployed? Written by `.apk.scripts/smoke.py` from the module's own shape; what each check means is in that script's header.

← [Wiki home](../README.md)

**❌ FAIL** — 2/3 checks, since 2026-11-12 00:16 EST

| Check | Target | Result | Detail |
|---|---|---|---|
| pushed | [APK.softapp.DATATYPE.KiCad](https://github.com/LikeDotAudio/APK.softapp.DATATYPE.KiCad.git) | ❌ | 1 commit(s) not pushed |
| web | [index.html](https://apk.audio/APK%3ASoftapps/DATATYPE/DATATYPE.KiCad/index.html) | ✅ | HTTP 200 |
| app | `OS/KiCad Netlist` → `PODS/POD.THIN/Softapps/DATATYPE/DATATYPE.KiCad/index.html` | ✅ | present |

Re-run: `python3 .apk.scripts/smoke.py PODS/POD.THIN/Softapps/DATATYPE/DATATYPE.KiCad`

<!-- smoke:sig 97ca098b3020 since 2026-11-12 00:16 EST -->
