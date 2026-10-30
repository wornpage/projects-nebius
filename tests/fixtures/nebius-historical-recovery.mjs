import { recoveryExampleFiles } from '../../examples/nebius-recovery-simulator.mjs';
import { appendServerBridge } from '../../worker/nebius-run-materialization.mjs';

// Historical five-input authored reference for its existing qualification cases.
// No application route serves this source. This only assembles source data;
// it does not execute the reference or qualify the current six-input simulator.
export const historicalRecoveryFiles = () => appendServerBridge(recoveryExampleFiles());
