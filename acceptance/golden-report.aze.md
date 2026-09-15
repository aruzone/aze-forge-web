---
azemark: 2
title: Alpha smoke report
author:
  - AzeForge Web deployment acceptance
---

# Alpha smoke report

This Source is the deployment acceptance golden. It is compiled to every
Artifact format the service advertises, and each downloaded Artifact is verified
against the byte-integrity hash the service published for it. It is deliberately
representative rather than exhaustive: prose, mathematics, a callout, a table,
a diagram rendered by the pinned browser, an analytic plot and a chart.

The acceptance suite never trusts this document to be valid by assertion: it
analyzes it first, and a single unsatisfied diagnostic fails the check.

## Mathematics

:::: equation
id: gaussian-integral
number: true
----
integral x=-infinity..infinity of exp(-x^2) dx = sqrt(pi)
::::

:::: derivation
id: geometric-series
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

## Materials

:::: callout
variant: note
title: Determinism
----
Artifacts are self-contained and deterministic: the same Source always
produces byte-identical output.
::::

:::: table
caption: Representative material properties
id: materials
----
columns:
  - key: material
    name: Material
    type: text
  - key: density
    name: Density [kg/m^3]
    type: quantity
    unit: kg/m^3
  - key: conductivity
    name: Conductivity [W/(m K)]
    type: quantity
    unit: W/(m K)
rows:
  - material: Aluminum
    density: 2700
    conductivity: 205
  - material: Steel
    density: 7850
    conductivity: 50
  - material: Glass
    density: 2500
    conductivity: 1.0
::::

## Measurement flow

:::: mermaid
id: acceptance-flow
title: Deployment acceptance flow
----
flowchart LR
  submit[Submit golden Source] --> analyze[Analyze]
  analyze --> valid{Valid?}
  valid -- No --> report[Fail the check]
  valid -- Yes --> render[Render every format]
  render --> verify[Verify published hash]
::::

## RC step response

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

## Benchmark charts

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
