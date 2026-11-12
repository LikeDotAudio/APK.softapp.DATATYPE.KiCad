# DATATYPE.KiCad — KiCad Netlist Importer & Exporter

**Wiki:** [Documentation/README.md](Documentation/README.md) — principles, architecture, delivery.

KiCad Netlist Translator: import and export schematic netlists in KiCad Eeschema s-expression format ((export (version D) ...)); resolves components, footprints, pins, and electrical nets for KiCad PCB layout routing.

| | |
|---|---|
| **Opens** | the OS shell (Pipeline → Translators & Formats), or `index.html` standalone |
| **Build** | none — plain web files; `npm test` |
| **Ships** | baked into WEB.Frontend-Assets (`up-stack.sh WEB.Frontend-Assets`), served at `:8080/Softapps/DATATYPE/DATATYPE.KiCad/` |

<!-- wiki:smoke -->
**Smoke test** — ✅ PASS 3/3 since 2026-11-12 00:27 EST — [results](Documentation/%F0%9F%A7%A9Manual%20and%20Artifacts/SMOKE.md)
<!-- /wiki:smoke -->
