---
azemark: 2
title: AzeForge alpha walkthrough
author: AzeForge alpha walkthrough
citation-style: numeric
x-circuit-symbol-convention: iec
---

# AzeForge alpha walkthrough

This Source is the owner walkthrough's representative document. It spans all ten
native capability families and the document-composition layer around them, in
one file and one identifier namespace, so a single pass over the deployed
service exercises the whole approved catalog rather than a sample of it.

Read it as a short engineering report: a derivation, measured response data, a
construction, an architecture, a schematic, a transaction, a reaction, a control
loop, and the tables and proofs that carry the argument. It is deliberately
representative rather than exhaustive — every family is present, and the
document level features it must share (`@` references, a citation, an endnote,
a numbered figure) are present too.

## Mathematics

The response of a first-order system begins with a Gaussian normalisation and
one worked series identity.

:::: equation
id: gaussian-integral
number: true
----
integral x=-infinity..infinity of exp(-x^2) dx = sqrt(pi)
::::

:::: derivation
id: geometric-series-sum
number: true
----
- expression: S_n = sum i=0..n of r^i
  annotation: partial sum of the first n + 1 powers
- expression: r * S_n = sum i=1..n+1 of r^i
  annotation: multiply every term by r
- expression: S_n - r * S_n = 1 - r^(n+1)
  annotation: subtraction telescopes the interior terms
- expression: S_n = (1 - r^(n+1)) / (1 - r)
  annotation: closed form, valid for r != 1
::::

## Response data

@geometric-series-sum bounds the sampling of the step response below, and the
benchmark chart records the same experiment on two suites.

:::: plot
id: rc-step-response
number: true
parameters:
  V0: 5
  R: 1000
  C: 1e-6
x-axis:
  label: time (s)
  min: 0
  max: 0.005
y-axis:
  label: voltage (V)
  min: 0
----
- kind: function
  label: analytic step response
  variable: t
  expression: V0 * (1 - exp(-t / (R * C)))
  domain:
    min: 0
    max: 0.005
  samples: 400
- kind: scatter
  label: measured points
  points:
    - x: 0.0005
      y: 1.99
      error: 0.08
    - x: 0.001
      y: 3.11
      error: 0.10
    - x: 0.002
      y: 4.36
      error-low: 0.14
      error-high: 0.09
::::

:::: chart
id: bench-scores
number: true
type: grouped-bar
x-label: suite
y-label: score
----
- label: alpha
  bars:
    - category: parse
      value: 12
      error: 0.5
    - category: render
      value: 19
- label: beta
  bars:
    - category: parse
      value: 9
    - category: render
      value: 22
      error-low: 1
      error-high: 2
::::

## Constructions

The constructions below are authored twice: once from typed coordinates, once
from named primitives with backward-only references. The tangent resolves its
branch with an explicit pick, because the construction admits two.

:::: geometry
id: coordinate-triangle
number: true
caption: Coordinate triangle with an explicit altitude
----
- kind: point
  name: a
  label: A
  x: 0
  y: 4
- kind: point
  name: b
  label: B
  x: -3
  y: 0
- kind: point
  name: c
  label: C
  x: 3
  y: 0
- kind: point
  name: foot
  label: D
  x: 0
  y: 0
- kind: segment
  name: bc
  from: b
  to: c
- kind: segment
  name: ab
  from: a
  to: b
- kind: segment
  name: ac
  from: a
  to: c
- kind: segment
  name: altitude
  from: a
  to: foot
  style: dashed
- kind: right-angle-mark
  first: a
  second: foot
  third: c
- kind: length-mark
  from: a
  to: foot
  label: h
::::

:::: geometry
id: constructed-tangent
number: true
caption: Constructed circle tangent with an explicit branch
----
- kind: point
  name: center
  label: O
  x: 0
  y: 0
- kind: circle
  name: main-circle
  center: center
  radius: 2
- kind: point
  name: outside
  label: P
  x: 5
  y: 0
- kind: tangent-line
  name: upper-tangent
  circle: main-circle
  from: outside
  pick: 2
::::

## Diagrams

Both diagram authoring modes are present: a cyclic flowchart, and an
architecture that nests groups, names ports and keeps two undirected parallel
edges between the same pair.

:::: diagram
id: request-flowchart
number: true
title: Request branching process
mode: flowchart
flow: top-to-bottom
----
- kind: node
  name: start
  label: Start
  shape: circle
- kind: node
  name: classify
  label: Classify request?
  shape: diamond
- kind: node
  name: cache
  label: Serve from cache
- kind: node
  name: render
  label: Render from source
- kind: edge
  from: start
  to: classify
- kind: edge
  from: classify
  to: cache
  label: hit
- kind: edge
  from: classify
  to: render
  label: miss
- kind: edge
  from: cache
  to: classify
  label: recheck
::::

:::: diagram
id: service-architecture
number: true
title: Service architecture
mode: architecture
flow: left-to-right
----
- kind: group
  name: edge-tier
  label: Edge tier
- kind: group
  name: service-tier
  label: Services
- kind: group
  name: data-tier
  label: Data tier
- kind: group
  name: persistence
  label: Persistence
  parent: data-tier
- kind: node
  name: client
  label: Browser
  parent: edge-tier
- kind: node
  name: gateway
  label: API gateway
  parent: edge-tier
  shape: hexagon
  ports:
    - name: inbound
      side: left
    - name: upstream
      side: right
- kind: node
  name: auth
  label: Auth service
  parent: service-tier
  shape: rounded
  ports:
    - name: api
      side: left
- kind: node
  name: catalog
  label: Catalog service
  parent: service-tier
  shape: rounded
  ports:
    - name: api
      side: left
- kind: node
  name: primary
  label: Primary database
  parent: persistence
  shape: cylinder
- kind: node
  name: replica
  label: Read replica
  parent: persistence
  shape: cylinder
- kind: edge
  from: client
  to: gateway.inbound
- kind: edge
  from: gateway.upstream
  to: auth.api
- kind: edge
  from: gateway.upstream
  to: catalog.api
- kind: edge
  from: auth
  to: primary
  direction: undirected
- kind: edge
  from: catalog
  to: primary
  direction: undirected
- kind: edge
  from: catalog
  to: replica
  direction: undirected
- kind: edge
  from: catalog
  to: replica
  label: fallback
  direction: undirected
::::

## Software and data models

All four model directives are present: a login exchange with an activation
balance the fragments respect, an order lifecycle with one initial state per
scope, an entity schema whose foreign key is validated against its target, and
a class hierarchy that realises an interface.

:::: sequence
id: login-exchange
number: true
title: Login exchange
----
participants:
  - name: user
    kind: actor
    label: User
  - name: web
    label: Web app
  - name: auth
    label: Auth service
  - name: store
    label: User store
timeline:
  - kind: message
    from: user
    to: web
    text: Submit credentials
    activate: true
  - kind: message
    from: web
    to: auth
    text: Verify session
    activate: true
  - kind: loop
    condition: Retry budget remains
    body:
      - kind: message
        from: auth
        to: store
        text: Load user
        activate: true
      - kind: message
        from: store
        to: auth
        form: return
        text: User record
        deactivate: true
  - kind: alt
    divisions:
      - condition: Credentials valid
        body:
          - kind: message
            from: auth
            to: web
            form: return
            text: Session token
            deactivate: true
          - kind: message
            from: web
            to: user
            form: return
            text: Dashboard
            deactivate: true
      - condition: Credentials rejected
        body:
          - kind: message
            from: auth
            to: web
            form: return
            text: Deny
            deactivate: true
          - kind: message
            from: web
            to: user
            form: return
            text: Sign-in page
            deactivate: true
  - kind: note
    over:
      - auth
      - store
    text: |
      Credentials never reach the user store;
      the auth service holds the hash.
::::

:::: state
id: order-lifecycle
number: true
title: Order lifecycle
----
- kind: initial
  name: entry
- kind: state
  name: Draft
- kind: state
  name: Cancelled
- kind: final
  name: Completed
- kind: transition
  from: entry
  to: Draft
- kind: transition
  from: Draft
  to: Cancelled
  trigger: abandoned
- kind: transition
  from: Draft
  to: Completed
  guard: payment settled
  action: emit receipt
- kind: transition
  from: Cancelled
  to: Completed
::::

:::: entity
id: shop-schema
number: true
----
- kind: entity
  name: Customer
  attributes:
    - name: id
      type: uuid
      keys:
        - primary
    - name: email
      type: text
      keys:
        - unique
    - name: nickname
      type: text
      optional: true
- kind: entity
  name: Order
  attributes:
    - name: id
      type: uuid
      keys:
        - primary
    - name: customer_id
      type: uuid
      keys:
        - foreign
      references:
        entity: Customer
        attribute: id
    - name: placed_at
      type: timestamp
    - name: total
      type: money
- kind: relationship
  label: places
  first:
    entity: Customer
    cardinality: one
    role: buyer
  second:
    entity: Order
    cardinality: one-or-many
::::

:::: class
id: payment-classes
number: true
title: Payment classes
----
- kind: interface
  name: PaymentGateway
  operations:
    - name: authorize
      parameters:
        - name: amount
          type: Money
      return-type: Authorization
- kind: class
  name: StripeGateway
  attributes:
    - name: api_key
      type: string
      visibility: private
  operations:
    - name: authorize
      visibility: public
      parameters:
        - name: amount
          type: Money
      return-type: Authorization
- kind: class
  name: RefundableOrder
  abstract: true
  attributes:
    - name: refund_window
      type: Duration
      visibility: protected
- kind: class
  name: Order
  attributes:
    - name: id
      type: OrderId
      visibility: private
  operations:
    - name: total
      visibility: public
      return-type: Money
- kind: class
  name: LineItem
  attributes:
    - name: sku
      type: string
      visibility: private
- kind: relationship
  form: implementation
  from: StripeGateway
  to: PaymentGateway
- kind: relationship
  form: inheritance
  from: RefundableOrder
  to: Order
- kind: relationship
  form: composition
  from: Order
  to: LineItem
  label: lines
  from-multiplicity: one
  to-multiplicity: one-or-many
::::

## Circuits

The schematic is coordinate-free and floats: every terminal is bound, and the
layout is the renderer's business. The symbol convention comes from the
document front matter.

:::: circuit
id: rc-low-pass
number: true
title: RC low-pass
----
- kind: node
  ref: n1
- kind: node
  ref: n2
- kind: voltage-source
  ref: V1
  value: 5 V
- kind: resistor
  ref: R1
  value: 1 kohm
- kind: capacitor
  ref: C1
  value: 1 uF
- kind: connect
  terminal: V1.positive
  node: n1
- kind: connect
  terminal: V1.negative
  node: n2
- kind: connect
  terminal: R1.a
  node: n1
- kind: connect
  terminal: R1.b
  node: n2
- kind: connect
  terminal: C1.a
  node: n1
- kind: connect
  terminal: C1.b
  node: n2
::::

## Timing

The same bus transaction is authored on both timing scales — cycles with wave
strings, and time with explicit intervals — to show that the scale is a
presentation choice over one interval model.

:::: timing
id: clocked-bus-transaction
number: true
title: Clocked bus transaction
description: single handshake
scale: cycles
----
- kind: signal
  ref: clk
  clock: true
  wave: 2p2n2p2n
- kind: signal
  ref: valid
  wave: 00000111
- kind: signal
  ref: ready
  wave: 00000011
- kind: signal
  ref: addr
  width: 8
  wave: x={A5}={A6}.
- kind: signal
  ref: data
  width: 8
  phase: 1
  wave: zz={D0}x
- kind: group
  label: Transaction
  signals: addr, data
- kind: marker
  at: 0
  label: Reset
- kind: arrow
  from: addr@1
  to: valid@5
  label: setup
::::

:::: timing
id: clocked-bus-transaction-time
number: true
title: Clocked bus transaction on the time scale
description: single handshake
scale: time
unit: ns
----
- kind: signal
  ref: clk
  clock: true
  intervals:
    - state: rise
      duration: 2
    - state: fall
      duration: 2
    - state: rise
      duration: 2
    - state: fall
      duration: 2
- kind: signal
  ref: valid
  intervals:
    - state: low
      duration: 5
    - state: high
      duration: 3
- kind: signal
  ref: ready
  intervals:
    - state: low
      duration: 6
    - state: high
      duration: 2
- kind: signal
  ref: addr
  width: 8
  intervals:
    - state: unknown
      duration: 1
    - state: bus
      duration: 1
      value: A5
    - state: bus
      duration: 1
      value: A6
    - state: continue
      duration: 1
- kind: signal
  ref: data
  width: 8
  phase: 1
  intervals:
    - state: impedance
      duration: 2
    - state: bus
      duration: 1
      value: D0
    - state: unknown
      duration: 1
- kind: group
  label: Transaction
  signals: addr, data
- kind: marker
  at: 0
  label: Reset
- kind: arrow
  from: addr@1
  to: valid@1
  label: setup
::::

## Chemistry

All three chemistry directives: a bare formula, a reaction that asserts its own
balance, and a structure in which every fact is either specified or explicitly
unspecified.

:::: formula
id: water
number: true
----
H2O
::::

:::: reaction
id: silver-chloride
number: true
balance: check
----
Ag+(aq) + Cl-(aq) -> AgCl(s)
::::

:::: structure
id: alanine-specified
number: true
----
- atom: ca
  element: C
  isotope: 14
  at: [1.2, -0.7]
- atom: cb
  element: C
  at: [0.0, 0.0]
- atom: n
  element: N
  at: [0.0, 1.4]
- bond:
  from: cb
  to: n
  order: 1
  stereo: wedge
- bond:
  from: ca
  to: cb
  order: 1
- label:
  text: (S)
  at: [-0.5, 0.7]
::::

## Engineering diagrams

The control loop draws its takeoff as two plant out-edges, and pairs its
summing signs with the authored in-edge order. The free body authors an
explicit scale, so every force length is derived from its magnitude and no
angle is guessed.

:::: control
id: pitch-loop
number: true
title: Feedback controller
flow: left-to-right
----
- kind: input
  name: ref
  label: Θ_c(s)
- kind: sum
  name: err
  signs: [+, -]
- kind: block
  name: ctrl
  tf: K_p (1 + 1/(T_i s))
- kind: block
  name: plant
  tf: 1/(s(s+2))
- kind: output
  name: out
  label: Θ(s)
- kind: edge
  from: ref
  to: err
  label: Θ_c(s)
- kind: edge
  from: err
  to: ctrl
  label: e(s)
- kind: edge
  from: ctrl
  to: plant
  label: u(s)
- kind: edge
  from: plant
  to: out
  label: Θ(s)
- kind: edge
  from: plant
  to: err
  label: Θ(s)
::::

:::: free-body
id: incline-block
number: true
title: Block on an inclined plane
scale: 0.15
----
- kind: point
  name: toe
  x: 0
  y: 0
  visible: false
- kind: point
  name: heel
  x: 6
  y: 0
  visible: false
- kind: point
  name: top
  x: 6
  y: 2.18
  visible: false
- kind: polygon
  name: wedge
  vertices:
    - toe
    - heel
    - top
- kind: block
  name: slider
  x: 2.83
  y: 1.56
  width: 1.6
  height: 1
  angle: 20
- kind: point
  name: com
  label: G
  x: 2.83
  y: 1.56
- kind: point
  name: contact
  x: 3
  y: 1.09
  visible: false
- kind: line
  name: slope-face
  from: toe
  to: top
- kind: force
  at: com
  angle: 270
  magnitude: 19.6
  label: mg
- kind: force
  at: contact
  perpendicular-to: slope-face
  magnitude: 18.4
  label: N
- kind: force
  at: contact
  parallel-to: slope-face
  magnitude: 6.7
  label: f
- kind: axes
  at: com
  angle: 20
  x-label: x′
  y-label: y′
- kind: angle-mark
  first: heel
  vertex: toe
  third: top
  label: θ
- kind: dimension
  from: (2.08, 1.29)
  to: (3.58, 1.83)
  label: L
::::

## Structured content

The tenth family: a typed table whose quantity column carries its unit once, a
procedure, a proved statement, and a worked example.

:::: table
id: trial-summary
number: true
caption: Typed trial summary
----
columns:
  - key: trial
    name: Trial
    type: text
  - key: reading
    name: Reading
    type: decimal
    align: center
  - key: density
    name: Density
    type: quantity
    unit: kg/m^3
  - key: retained
    name: Retained
    type: boolean
rows:
  - trial: A1
    reading: 344.2
    density: 2700
    retained: true
  - trial: A2
    reading: 344.5
    density: 2500
    retained: false
::::

:::: algorithm
id: binary-search
number: true
caption: Binary search over a sorted array
----
procedure: BinarySearch
parameters:
  - A
  - target
steps:
  - assign: lo = 0
  - assign: hi = length(A) - 1
  - while: lo <= hi
    do:
      - assign: mid = floor((lo + hi) / 2)
      - if: A[mid] == target
        then:
          - return: mid
      - if: A[mid] < target
        then:
          - assign: lo = mid + 1
        else:
          - assign: hi = mid - 1
  - return: -1
::::

:::: statement
id: triangle-inequality
number: true
kind: theorem
caption: Triangle inequality in the plane
----
text: |
  For any three points `A`, `B`, `C` the sum of two sides is at least the third.
proof: |
  Expand each distance and compare squared lengths:

  :: equation
  ----
  abs(A - C) <= abs(A - B) + abs(B - C)
  ::
::::

:::: example
id: cooling-model
number: true
caption: Deriving the exponential cooling model
----
problem: |
  Fit Newton's law and predict the temperature at `600 s`.
givens:
  - ambient temperature held constant
steps:
  - text: |
      Solve the law with the initial condition:

      :: derivation
      ----
      - expression: T(t) = T_amb + (T_0 - T_amb) * exp(-k * t)
        annotation: general solution
      ::
result: |
  `T(600) ~= 333.1 K`.
::::

## Composition

@request-flowchart is the branch a request takes, @binary-search is the lookup
that guards it, and @payment-classes is what the branch charges.[^method] The
figure below wraps an equation in the same numbering namespace as everything
else in this document.

:::: figure
id: wrapped-prediction
number: true
caption: Wrapped prediction
----
:: equation
id: wrapped-prediction-equation
----
T(600) = 295 + 49.2 * exp(-0.00334 * 600)
::
::::

The convention for the cooling fit follows [@knuth-1984, page 23].

:::: bibliography
----
- key: knuth-1984
  type: book
  title: The TeXbook
  authors:
    - name: Donald E. Knuth
      family: Knuth
  year: 1984
  publisher: Addison-Wesley
::::

[^method]: One endnote-rendered footnote definition.
