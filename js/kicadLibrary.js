// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadLibrary.js — KICAD SYMBOL LIBRARIES IN AND OUT, KiCad AS THE TARGET.
   DATATYPE.KiCad owns it (the KiCad importer / exporter); another page that needs it takes a byte copy.

   The target is the stock KiCad library as it ships (gitlab.com/kicad/libraries/kicad-symbols, KiCad 10):
   one symbol per .kicad_sym file inside <Library>.kicad_symdir/, file version 20251024, judged by the
   KiCad Library Conventions (KLC, klc.kicad.org; our copy and rule index: DATA.KICAD
   SRC/Reference/KLC, js/klcRules.js). Every rule this file applies or checks is cited as "KLC <id>".

     readSymbolLib(text)         a .kicad_sym (one symbol or a whole KiCad 6–10 library) → symbols
     resolveExtends(symbols)     a derived symbol (extends "Base") gets its base's units and pins
     writeSymbolLib(symbols)     symbols → .kicad_sym text (an imported symbol writes back its own tree)
     writeSymdir(library, syms)  {"<Library>.kicad_symdir/<Name>.kicad_sym": text}: the upstream layout
     symbolFromPart(part)        a BIM part (apk.bim.part/1, or partFromIfc's answer) → a KLC symbol
     partFromSymbol(sym)         a KiCad symbol → a BIM part draft (its ports from the pins)
     partFromIfc(text)           the BIM part's IFC type (GET /api/bim/parts/<maker>/<model>.ifc) → part
     klcCheck(sym)               [{rule, level, message, pin?}]: what KLC says about the symbol
     parseFootprintId(id)        'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm' → {library, family, pins, pitch, …}
     footprintFilterMatches(f, id)  a ki_fp_filters pattern against a footprint (KLC S5.2 wildcards)

   OUR FIELDS. A stock symbol carries Reference, Value, Footprint, Datasheet, Description, ki_keywords,
   ki_fp_filters (KLC S6.2). Ours carry those AND hidden APK_* fields that tie the symbol to its BIM part
   and IFC type, so a symbol comes back to the library it came from:
     APK_PartId   the BIM part id (maker/model) = the IFC type's Tag and APK_Part.PartId
     APK_IfcType  the IFC type entity (IfcAudioVisualApplianceType …)
     APK_Manufacturer / APK_Model / APK_Category / APK_Class / APK_Stage   the part's words
     APK_Ports    JSON [{n, group, side, domain, connector, block}]: pin number → its BIM port row
   KLC S6.2 allows a library its own fields only by agreement ("KLC_" there); APK_ is ours, so klcCheck
   reports them as info, not errors, and { upstream: true } writes a symbol without them: the shape a
   merge request to kicad-symbols needs. */

import { KLC_REFDES, KLC_RULES } from './klcRules.js';

export { KLC_RULES, KLC_REFDES };

/* The library lives in the files below; this one is the door every caller imports from. */
export {
  KICAD_SYM_VERSION, TARGETS, DEFAULT_TARGET, GENERATOR, GRID, TEXT, BODY_LINE, PIN_NAME_OFFSET, STOCK_FIELDS, PIN_TYPES, Str, sexpParse, num, sexpWrite,
} from './kicadSexp.js';
export {
  symbolFromNode, readSymbolLib, resolveExtends, prop, symbolNode, writeSymbolLib, forTarget, writeSymdir, symLibTableRow, safeName,
} from './kicadSymbolIo.js';
export {
  pinName, refdesFor, terminals, pinTypeFor, keywordsFor, symbolFromPart, panelPages, defaultLibrary, partFromSymbol, partFromIfc,
} from './kicadSymbol.js';
export {
  klcCheck, klcSummary, parseFootprintId, footprintFilterMatches, libraryRows, libraryOfPath,
} from './kicadKlc.js';
export {
  symbolSvg,
} from './kicadSvg.js';
export {
  SCH_TARGETS, stableUuid, sheetPoint, writeSchematic, projectSymLibTable, zipFiles,
} from './kicadSchematic.js';
