// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadHost.js — the netlist block in and out of the CAD over
   cad.like.audio/host@1, through the vendored APKSoftapp client (ROAD-3491).
   Block: { type: 'kicad_netlist', components: [{ref, value, footprint, lib, part, bimId?}],
   nets: [{ name, nodes: [{ ref, pin }] }] }. No DOM here: the tests drive it. */

export const EDITOR = 'KiCad Netlist Translator';
export const BLOCK_TYPE = 'kicad_netlist';

/** The starting document: a sample, labelled as one, until a block or file arrives. */
export function sampleNetlist() {
  return {
    components: [
      { ref: 'J1', value: 'XLR-F-3PIN', footprint: 'Connector:Neutrik_NC3FAAH', lib: 'Audio', part: 'XLR3' },
      { ref: 'U1', value: 'THAT1512', footprint: 'Package_SO:SOIC-8', lib: 'Audio', part: 'PREAMP' },
      { ref: 'J2', value: '1/4-TRS', footprint: 'Connector:Switchcraft_112', lib: 'Audio', part: 'TRS' },
    ],
    nets: [
      { name: 'MIC_HOT', nodes: [{ ref: 'J1', pin: '2' }, { ref: 'U1', pin: '2' }] },
      { name: 'MIC_COLD', nodes: [{ ref: 'J1', pin: '3' }, { ref: 'U1', pin: '3' }] },
      { name: 'GND', nodes: [{ ref: 'J1', pin: '1' }, { ref: 'U1', pin: '4' }, { ref: 'J2', pin: 'S' }] },
    ],
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);

/** A block, a bare { components, nets }, or nothing → { components, nets }. */
export function fromBlock(block) {
  const b = block && typeof block === 'object' ? block : {};
  return {
    components: arr(b.components).map((c) => {
      const o = { ref: String(c.ref ?? ''), value: String(c.value ?? ''), footprint: String(c.footprint ?? ''), lib: String(c.lib ?? ''), part: String(c.part ?? '') };
      if (c.bimId) o.bimId = String(c.bimId); // the BIM part it is an occurrence of (its .ifc type on Save Model)
      return o;
    }),
    nets: arr(b.nets).map((n) => ({ name: String(n.name ?? ''), nodes: arr(n.nodes).map((x) => ({ ref: String(x.ref ?? ''), pin: String(x.pin ?? '') })) })),
  };
}

export function toBlock(state) {
  return { type: BLOCK_TYPE, components: state.components, nets: state.nets };
}

/** One row per net for the nets table: its nodes as "J1.2, U1.2". */
export function netRows(nets) {
  return nets.map((n) => ({ name: n.name, nodes: n.nodes.map((x) => `${x.ref}.${x.pin}`).join(', '), count: n.nodes.length }));
}

/** state = { components, nets } (mutated in place on load); onLoaded(state, meta, block) redraws. */
export function connectKiCadHost(S, state, { onLoaded, notice } = {}) {
  return S.connectHost({
    editor: EDITOR,
    blockType: BLOCK_TYPE,
    block: toBlock(state),
    notice,
    onLoad: (block, meta) => {
      Object.assign(state, fromBlock(block));
      if (onLoaded) onLoaded(state, meta, block);
    },
    onRequest: () => ({ block: toBlock(state), meta: { filename: 'kicad_netlist', title: `KiCad netlist (${state.components.length} parts)` } }),
  });
}
