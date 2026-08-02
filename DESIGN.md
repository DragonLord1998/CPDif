# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-02
- Primary product surfaces: dependency-free Node browser studio and its Colab launcher.
- Evidence reviewed: `flux-klein-studio(5).html`, `ui/public/index.html`, `ui/public/styles.css`, `ui/public/app.js`, `ui/lib/runtime.mjs`, `src/main.cpp`, the accepted Visual Ralph artifacts under `.omx/artifacts/visual-ralph/flux-klein-studio/`, and Black Forest Labs' official FLUX.2 generation and single-reference prompting guides.

## Brand

- Personality: focused, technical, calm, and approachable.
- Trust signals: visible native-runtime readiness, honest capability labels, exact execution status, telemetry, and recoverable errors.
- Avoid: decorative controls with no backend effect, hidden mode changes, dense dashboard chrome, and fake model capabilities.

## Product goals

- Goals: make FLUX.2 Klein generation and editing understandable as a visual image flow; keep common generation one action; expose connected edits without requiring CLI knowledge; optionally improve user prompts with a local vision-language model.
- Non-goals: a general ComfyUI replacement, arbitrary cyclic graphs, concurrent GPU execution, silent prompt replacement, cloud prompt processing, or controls unsupported by the native runtime.
- Success signals: a user can infer node behavior from its wires, create a generation or edit chain, run it once, and understand every output and failure.

## Personas and jobs

- Primary personas: creators using a Colab GPU and technical users validating the native runtime.
- User jobs: generate an image from text, transform an existing generated image, chain several edits, improve a rough prompt without losing its intent, inspect timings, and download results.
- Key contexts of use: desktop browser, Colab proxy, single attached A100 or RTX PRO 6000 GPU.

## Information architecture

- Primary navigation: one node canvas with runtime status and global canvas actions.
- Core routes/screens: studio canvas, expanded output dialog, and native log disclosure.
- Content hierarchy: workflow nodes first, active execution second, telemetry and logs on demand.

## Design principles

- Connections are configuration: a Klein node with no incoming image wire is Generate; a node with one incoming image wire is Edit.
- Reveal consequences immediately: mode badge, prompt label, button copy, and validation update as wires change.
- Preserve the fast path: a connected Generate to Edit pair maps to native `generate-edit` and one loaded model context.
- Prompt assistance is explicit and reversible: Qwen rewrites only after a user action, preserves the original for Undo, and never blocks native generation when unavailable.
- Local means local: prompt text and optional reference pixels travel only from the Node server to a configured loopback model endpoint.
- Tradeoffs: workflows may branch from earlier outputs but remain acyclic and accept at most one image input per Klein node so behavior matches the native CLI exactly.

## Visual language

- Color: light neutral canvas, purple model and connection emphasis, green readiness, amber pending, red error.
- Typography: compact system sans serif with clear weight hierarchy; monospace only for logs.
- Spacing/layout rhythm: 4/8/12/16 pixel rhythm with generous canvas whitespace.
- Shape/radius/elevation: rounded white nodes, restrained borders, soft purple-tinted elevation.
- Motion: short state transitions and spinners; no decorative continuous motion.
- Imagery/iconography: small functional symbols and real output thumbnails.

## Components

- Existing components to reuse: app header, canvas toolbar, draggable/resizable node shell, ports, wires, parameter fields, runtime pills, execution card, output preview, modal, and toast.
- New/changed components: Add Klein Node action, dynamic Klein node, inferred mode badge, removable connection, per-stage output selector, Improve prompt action, Undo prompt action, and independent assistant readiness.
- Variants and states: Generate, Edit, selected, disconnected, invalid, queued, running, completed, cancelled, and failed.
- Token/component ownership: CSS custom properties and component rules remain in `ui/public/styles.css`; graph behavior remains dependency-free in `ui/public/app.js`.

## Accessibility

- Target standard: practical WCAG 2.1 AA behavior for the supported surface.
- Keyboard/focus behavior: visible focus, keyboard-operable add/remove/run actions, labelled inputs, and Enter shortcuts that do not create accidental connections.
- Contrast/readability: retain existing high-contrast text and status colors with accompanying words.
- Screen-reader semantics: announce inferred mode and execution status; do not rely on wire geometry alone.
- Reduced motion and sensory considerations: respect reduced motion for transforms and spinners where practical.

## Responsive behavior

- Supported breakpoints/devices: modern desktop browsers first; narrow tablet/mobile remains viewable through canvas scrolling and zoom.
- Layout adaptations: header compacts, node graph remains pannable/scrollable, controls wrap without hiding required actions.
- Touch/hover differences: pointer events support drag/resize; primary behavior never depends solely on hover.

## Interaction states

- Loading: disable the run action, show the active stage and native log progress.
- Empty: the first Klein node starts in Generate mode with an example prompt.
- Error: identify the node or connection that blocks execution and retain user input.
- Success: show every stage output and timing; select the final output by default.
- Disabled: use disabled controls only when runtime readiness or workflow validity prevents execution.
- Offline/slow network: runtime status remains explicit; prompt assistance, LoRA downloads, and native jobs retain independent errors. Prompt assistance remains optional.

## Content voice

- Tone: direct, concise, and technically honest.
- Terminology: Generate for zero image inputs; Edit for one image input; image connection rather than reference strength.
- Microcopy rules: describe the next action, name the affected stage, label whether Qwen used vision, preserve exact quoted text and color values, and never claim a downloaded LoRA is applied before native support exists.

## Implementation constraints

- Framework/styling system: dependency-free Node 20 server and plain HTML/CSS/JavaScript.
- Design-token constraints: extend the existing CSS variables; do not introduce another design-system layer.
- Performance constraints: serialize GPU jobs, fuse the first Generate to Edit pair through native `generate-edit` when compatible, and unload the prompt model immediately after every rewrite before native inference begins.
- Compatibility constraints: one image input per Edit node; no reference-strength control exists in the native CLI; the prompt assistant must use a loopback HTTP endpoint and must not become a generation prerequisite.
- Test/screenshot expectations: Node unit/integration tests, Python repository tests, real browser interaction checks, and a visual screenshot review before publication.

## Open questions

- [ ] Should a future native serving mode keep the model loaded across edit stages beyond the first fused pair? Owner: runtime; impact: latency.
- [ ] Should uploaded image-source nodes be added after connected generated-image workflows? Owner: product; impact: external reference workflows.
- [ ] What native contract should multiple-reference conditioning use? Owner: runtime; impact: allowing more than one image input.
- [ ] Should a future prompt-assistant manager support MLX and OpenAI-compatible local servers in addition to Ollama? Owner: runtime; impact: broader local hardware support.
