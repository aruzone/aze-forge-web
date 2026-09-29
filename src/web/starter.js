// @ts-check

/**
 * The default document: a capability tour, one Cell per family.
 *
 * Every entry starts with a heading so Cell boundaries survive a format
 * round-trip (`parseDocument` splits on top-level headings), and every
 * snippet is the smallest compiling form lifted verbatim from the
 * `examples.json` reference library. The circuit family needs an explicit
 * symbol convention, carried as document metadata.
 */

/** @returns {import("./workspace-state.js").CurrentDocument} */
export function starterDocument() {
  return {
    version: "2",
    title: "Trying AzeForge",
    authors: ["AzeForge examples"],
    date: "",
    metadata: "x-circuit-symbol-convention: iec",
  };
}

export const STARTER_CELLS = [
  `# Try AzeForge

Edit any Cell below, then Refresh preview. Each Cell is one capability.`,
  `## Mathematics

An equation typesets one readable expression.

:::: equation
id: ohm-relation
----
V = I * R
::::`,
  `## Chemistry

A formula Block carries exactly one expression line.

:::: formula
id: water
number: true
----
H2O
::::`,
  `## Physics

A free-body places bodies and forces in one y-up unitless frame.

:::: free-body
id: trolley-push
number: true
title: Trolley push, schematic
description: Two forces on a trolley drawn to no shared scale
----
- kind: block
  name: trolley
  x: 0
  y: 0
  width: 2
  height: 1
- kind: point
  name: hub
  label: C
  x: 0
  y: 0
- kind: point
  name: rail
  x: -3
  y: -1
  visible: false
- kind: point
  name: rail-end
  x: 3
  y: -1
  visible: false
- kind: line
  name: rail-line
  visible: true
  style: dashed
  from: rail
  to: rail-end
- kind: force
  at: hub
  angle: 0
  length: 1.5
  label: F
- kind: force
  at: hub
  parallel-to: rail-line
  length: 1
  label: f
- kind: force
  at: hub
  angle: 270
  length: 1.2
  label: W
- kind: angle-mark
  first: rail
  vertex: hub
  third: rail-end
  label: φ
::::`,
  `## Geometry

A geometry Block resolves ordered declarations into an SVG projection.

:::: geometry
id: optics-wedge
number: true
----
- kind: point
  name: vertex
  label: O
  x: 0
  y: 0
- kind: point
  name: arm-flat
  label: A
  x: 4
  y: 0
- kind: point
  name: arm-raised
  label: B
  x: 1.5
  y: 3.5
- kind: segment
  name: flat-arm
  from: vertex
  to: arm-flat
- kind: segment
  name: raised-arm
  from: vertex
  to: arm-raised
- kind: polygon
  name: wedge
  vertices:
    - vertex
    - arm-flat
    - arm-raised
::::`,
  `## Graph

A diagram authors nodes and edges; mode selects the rules.

:::: diagram
id: diagram-water-treatment-line
title: Water treatment line
mode: flowchart
flow: top-to-bottom
----
- kind: node
  name: intake
  label: Raw water intake
  shape: circle
- kind: node
  name: filter
  label: Sand filter
- kind: node
  name: chlorinate
  label: Chlorination
  shape: cylinder
- kind: edge
  from: intake
  to: filter
- kind: edge
  from: filter
  to: chlorinate
::::`,
  `## Plot

A plot draws function curves and measured points on shared axes.

:::: plot
id: logistic-growth
x-axis:
  label: time (h)
y-axis:
  label: population (10^6 cells)
----
- kind: function
  label: logistic growth
  variable: t
  expression: 40 / (1 + 39 * exp(-0.6 * t))
  domain:
    min: 0
    max: 12
  samples: 240
::::`,
  `## Chart

A chart draws one bar series across categories.

:::: chart
id: payload-mass-by-stage
type: bar
x-label: launch stage
y-label: payload mass (kg)
grid: true
----
- label: payload mass
  bars:
    - category: Stage 1
      value: 2400
    - category: Stage 2
      value: 1150
    - category: Upper stage
      value: 480
::::`,
  `## Circuit

A circuit binds components to named nodes; the renderer resolves the wires.

:::: circuit
id: divider-bias-network
title: Resistive divider bias network
----
- kind: node
  ref: rail
- kind: node
  ref: tap
- kind: node
  ref: return
  role: reference
  label: 0 V return
- kind: voltage-source
  ref: V1
  value: 12 V
  mode: dc
- kind: resistor
  ref: R1
  value: 1 kohm
- kind: resistor
  ref: R2
  value: 2 kohm
- kind: connect
  terminal: V1.positive
  node: rail
- kind: connect
  terminal: V1.negative
  node: return
- kind: connect
  terminal: R1.a
  node: rail
- kind: connect
  terminal: R1.b
  node: tap
- kind: connect
  terminal: R2.a
  node: tap
- kind: connect
  terminal: R2.b
  node: return
::::`,
  `## Timing

A timing Block places waveforms on the shared cycle grid.

:::: timing
id: timing-clock-enable
number: true
title: Clocked enable
description: one clock, one gate
scale: cycles
----
- kind: signal
  ref: clk
  clock: true
  wave: 2p2n2p2n
- kind: signal
  ref: enable
  wave: 0011
::::`,
  `## Sequence

A sequence orders messages between participants.

:::: sequence
id: cache-lookup
number: true
title: Cache lookup
description: One request and its reply across two participants.
----
participants:
  - name: client
    kind: actor
    label: Client
  - name: cache
    label: Cache
timeline:
  - kind: message
    from: client
    to: cache
    text: Read key
  - kind: message
    from: cache
    to: client
    form: return
    text: Cached value
::::`,
  `## Table

A typed table validates every cell against its column type.

:::: table
id: pilot-line-yields
number: true
caption: Pilot line yields
----
columns:
  - key: batch
    name: Batch
    type: text
  - key: units
    name: Units
    type: integer
  - key: accepted
    name: Accepted
    type: boolean
rows:
  - batch: B-101
    units: 480
    accepted: true
  - batch: B-102
    units: 512
    accepted: false
  - batch: B-103
    units: 466
    accepted: true
::::`,
];
