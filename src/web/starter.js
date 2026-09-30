// @ts-check

/**
 * The default document: a first-load showcase, one Cell per language guide.
 * Cell order follows the upstream reading order 01 to 12, so the tour reads
 * like the documentation: document basics, mathematics (equation plus
 * derivation), visualization (plot plus chart), geometry, chemistry (formula,
 * reaction, structure), circuit, timing, diagrams, engineering, models,
 * structured content, and composition. Every entry starts with a heading so
 * Cell boundaries survive a format round-trip (`parseDocument` splits on
 * top-level headings), and every snippet is the smallest compiling form
 * lifted verbatim from the `examples.json` reference library. The circuit
 * family needs an explicit symbol convention, carried as document metadata.
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

Edit any Cell below, then Refresh preview. Each Cell is one capability of the language guides 01 to 12.`,
  `## Document basics

A callout carries a titled note; prose, headings, lists, and tables compose around the directives.

:::: callout
id: steady-state-note
variant: note
title: Steady state
----
A run is complete when two readings taken 60 s apart agree to within 1%.
::::`,
  `## Mathematics

An equation typesets one readable expression; a derivation chains annotated steps.

:::: equation
id: ohm-relation
----
V = I * R
::::

:::: derivation
id: compound-interest-chain
----
- expression: A_1 = P_0 (1 + r)
- expression: A_n = P_0 (1 + r)^n
::::`,
  `## Visualization

A plot draws function curves on shared axes; a chart draws one bar series across categories.

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
::::

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
  `## Chemistry

Formulas carry one expression; reactions carry one species line; structures declare atoms, bonds, and labels.

:::: formula
id: water
number: true
----
H2O
::::

:::: reaction
id: silver-chloride-precipitation
number: true
----
Ag+(aq) + Cl-(aq) -> AgCl(s)
::::

:::: structure
id: water-structure
number: true
width: 320
height: 240
----
- atom: o
  element: O
  at: [0, 0]
- atom: h1
  element: H
  at: [-1.2, 0.8]
- atom: h2
  element: H
  at: [1.2, 0.8]
- bond:
  from: o
  to: h1
  order: 1
- bond:
  from: o
  to: h2
  order: 1
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
  `## Diagrams

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
  `## Engineering

Control wires signal-flow graphs; free-body places bodies and forces in one y-up frame.

:::: control
id: open-loop-heater
number: true
title: Open-loop heater
description: A single lag between the command and the measured outlet
flow: left-to-right
----
- kind: input
  name: cmd
  label: u(s)
- kind: block
  name: coil
  tf: 1/(1 + 3s)
- kind: output
  name: temp
  label: T(s)
- kind: edge
  from: cmd
  to: coil
  label: u(s)
- kind: edge
  from: coil
  to: temp
  label: T(s)
::::

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
  `## Models

Sequence orders messages; state declares a lifecycle; entity describes a schema; class declares classifiers.

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
::::

:::: state
id: parcel-lifecycle
number: true
title: Parcel lifecycle
description: Four states on a single path from intake to a final state.
----
- kind: initial
  name: intake
- kind: state
  name: Labeled
- kind: state
  name: InTransit
- kind: state
  name: Delivered
- kind: state
  name: Archived
- kind: final
  name: closed
- kind: transition
  from: intake
  to: Labeled
- kind: transition
  from: Labeled
  to: InTransit
- kind: transition
  from: InTransit
  to: Delivered
- kind: transition
  from: Delivered
  to: Archived
- kind: transition
  from: Archived
  to: closed
::::`,
  `## Structured content

Typed tables validate every cell; algorithms, statements, and worked examples compose records.

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
::::

:::: algorithm
id: dot-product
number: true
caption: Dot product of two equal-length vectors
----
procedure: DotProduct
parameters:
  - A
  - B
steps:
  - assign: total = 0
  - for: i = 0 to length(A) - 1
    do:
      - assign: total = total + A[i] * B[i]
  - return: total
::::`,
  `## Composition

A figure numbers ordinary Markdown so a pipe table becomes a numbered object.

:::: figure
id: trend-figure
number: true
caption: Measured trend
----
The figure body holds ordinary Markdown, so an image or a pipe table becomes
numberable by wrapping it here.

| Step | Value |
| --- | ---: |
| 1 | 12 |
| 2 | 15 |
::::`
];
