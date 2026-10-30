# Prior work and Nebius contribution

This edition builds on earlier Wornpage Projects interface concepts, public Wornpage components and a WebMCP challenge edition. Those foundations are prior work. The Nebius edition adds task-scoped model requests, bounded tool generation and Sandbox checks, isolated preview, retained evidence and a separate human decision. It does not require the private Projects backend.

The generated checker and the bundled recovery example have different provenance. A historical checker was generated through Nebius and checked in Sandbox; the recovery example includes assistant-authored changes after an earlier failed model attempt. Opening either example is not a new provider result.

## Model and dependency terms

The live judge configuration uses `nvidia/Nemotron-3.5-Super-VL`. Its [NVIDIA model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16) identifies the [OpenMDW License Agreement 1.1](https://openmdw.ai/license/1-1/). This is separate from the application’s MIT source license and from the original models used in retained recordings.

The application calls model IDs selected by its operator; it does not bundle model weights. Model availability and hosted-provider terms are separate from the source license. Review the relevant model cards: [NVIDIA Nemotron Nano](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8), [NVIDIA Nemotron Super](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8), and [NVIDIA Nemotron Ultra](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/modelcard).

The Nano and Super cards previously identified the [NVIDIA Nemotron Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/); the Ultra card separately identified the OpenMDW License Agreement 1.1. Verify current model-specific terms before use. Service IDs do not establish the provider's exact weights or quantization.

Source licensing and dependency attribution remain in LICENSE, LICENSING.md, THIRD_PARTY_NOTICES.md and THIRD_PARTY_LICENSES.txt. The public WebMCP baseline remains a separate project; see SOURCE_PROVENANCE.md.
