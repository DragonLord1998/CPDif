# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-02
- Primary product surfaces: dependency-free Node browser studio and its Colab launcher.
- Evidence reviewed: `flux-klein-studio(5).html`, the current Klein Studio Colab screenshot, `ui/public/index.html`, `ui/public/styles.css`, `ui/public/app.js`, `ui/lib/runtime.mjs`, `src/main.cpp`, `src/engine_sdcpp.cpp`, the accepted Visual Ralph artifacts under `.omx/artifacts/visual-ralph/flux-klein-studio/`, and Black Forest Labs' official FLUX.2 prompting guidance.

## Brand

- Personality: focused, technical, calm, and approachable.
- Trust signals: visible native-runtime readiness, honest capability labels, exact execution status, telemetry, and recoverable errors.
- Avoid: decorative controls with no backend effect, hidden mode changes, dense dashboard chrome, and fake model capabilities.

## Product goals

- Goals: make FLUX.2 Klein generation and editing understandable as a visual image flow; run only the Klein node the user invokes; accept up to four ordered reference images per edit; expose independent connectable Output nodes; optionally improve user prompts with a local vision-language model; optionally upscale a selected Output 4× with NVIDIA PiD.
- Non-goals: a general ComfyUI replacement, arbitrary cyclic graphs, concurrent GPU execution, silent prompt replacement, cloud prompt processing, or controls unsupported by the native runtime.
- Success signals: a user can infer node behavior from its wires, run one node without unintentionally rerunning completed upstream nodes, identify references as Image 1 through Image 4, and route any Klein result to one or more Output nodes.

## Personas and jobs

- Primary personas: creators using a Colab GPU and technical users validating the native runtime.
- User jobs: upload an existing image, generate an image from text, transform an uploaded or generated image, chain several edits, improve a rough prompt without losing its intent, inspect timings, and download results.
- Key contexts of use: desktop browser, Colab proxy, single attached A100 or RTX PRO 6000 GPU.

## Information architecture

- Primary navigation: one node canvas with runtime status and global canvas actions.
- Core routes/screens: studio canvas, expanded output dialog, and native log disclosure.
- Content hierarchy: workflow nodes first, active execution second, telemetry and logs on demand.

## Design principles

- Connections are configuration: a Klein node with no incoming image wire is Generate; a node with one to four ordered incoming image wires is Edit.
- Node buttons are local: Generate or Edit runs only that Klein node. A connected Klein source uses its last completed output; a missing source output blocks the run instead of silently executing upstream nodes.
- Reference order is visible: each connected image has a persistent 1–4 badge, thumbnail, and matching prompt language so users can write “Image 1” or “Image 2” unambiguously.
- Outputs are explicit sinks: Output nodes are independently addable, removable, and connectable to any Klein node; they display the last completed image for that source.
- Upscaling belongs to the sink: NVIDIA PiD 4× is an explicit Output-node action, preserves the original Klein result, caches its own PNG, and never reruns the Klein graph.
- Source nodes are visible: an uploaded Image node owns its preview and feeds Edit nodes through the same explicit image connection used by generated outputs.
- Canvas utilities remain nodes: LoRA downloads live in a compact standalone node below the Klein chain, visually separate from native execution status and explicitly labelled as stored-only until runtime application exists.
- Reveal consequences immediately: mode badge, prompt label, button copy, and validation update as wires change.
- Preserve native efficiency where it does not violate node-local execution; completed upstream images are reused rather than regenerated.
- Prompt assistance is explicit and reversible: Qwen rewrites only after a user action, preserves the original for Undo, and never blocks native generation when unavailable.
- Local means local: prompt text and optional reference pixels travel only from the Node server to a configured loopback model endpoint.
- Tradeoffs: workflows may branch from earlier outputs but remain acyclic; each Klein node accepts at most four ordered references; GPU jobs remain serialized.

## Visual language

- Color: light neutral canvas, purple model and connection emphasis, green readiness, amber pending, red error.
- Typography: compact system sans serif with clear weight hierarchy; monospace only for logs.
- Spacing/layout rhythm: 4/8/12/16 pixel rhythm with generous canvas whitespace.
- Shape/radius/elevation: rounded white nodes, restrained borders, soft purple-tinted elevation.
- Motion: short state transitions and spinners; no decorative continuous motion.
- Imagery/iconography: small functional symbols and real output thumbnails.

## Components

- Existing components to reuse: app header, canvas toolbar, draggable/resizable node shell, ports, wires, parameter fields, runtime pills, execution card, output preview, modal, and toast.
- New/changed components: Add Klein Node action, Add Image Node action, Add Output Node action, uploaded-image source node, standalone connectable Output node, four numbered reference slots with thumbnails, Output-node NVIDIA PiD 4× action, Original/4× view switch, standalone LoRA download node, inferred mode badge, Improve prompt action, Undo prompt action, and independent assistant readiness.
- Variants and states: Generate, Edit, selected, disconnected, uploading, uploaded, upscaling, original, PiD 4×, invalid, queued, running, completed, cancelled, and failed.
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
- Success: store the invoked Klein node's latest output and refresh every Output node connected to it.
- Disabled: use disabled controls only when runtime readiness or workflow validity prevents execution.
- Offline/slow network: runtime status remains explicit; prompt assistance, LoRA downloads, and native jobs retain independent errors. Prompt assistance remains optional.

## Content voice

- Tone: direct, concise, and technically honest.
- Terminology: Generate for zero image inputs; Edit for one to four image inputs; Image 1 through Image 4 for ordered references; Output node for a visible result sink.
- Microcopy rules: describe the next action, name the affected stage, label whether Qwen used vision, preserve exact quoted text and color values, and never claim a downloaded LoRA is applied before native support exists.

## Implementation constraints

- Framework/styling system: dependency-free Node 20 server and plain HTML/CSS/JavaScript.
- Design-token constraints: extend the existing CSS variables; do not introduce another design-system layer.
- Performance constraints: serialize Klein, prompt-assistant, and PiD GPU work; run only the invoked Klein node; reuse completed upstream outputs as immutable job references; cache PiD results beside their source job; unload the prompt model immediately after every rewrite before native inference begins.
- Compatibility constraints: one to four ordered image inputs per Edit node; uploaded and completed-job sources must be validated and resolved server-side without accepting client filesystem paths; no reference-strength control exists in the native CLI; the prompt assistant must use a loopback HTTP endpoint and must not become a generation prerequisite; PiD remains optional and uses NVIDIA's official FLUX.2 `from_clean` path with local checkpoints.
- Test/screenshot expectations: Node unit/integration tests, Python repository tests, real browser interaction checks, and a visual screenshot review before publication.

## Open questions

- [ ] Should a future native serving mode keep the model loaded across edit stages beyond the first fused pair? Owner: runtime; impact: latency.
- [ ] Should changing an upstream prompt visually mark its previous completed output as stale while keeping it reusable? Owner: product; impact: graph clarity.
- [ ] Should a future prompt-assistant manager support MLX and OpenAI-compatible local servers in addition to Ollama? Owner: runtime; impact: broader local hardware support.
