/* eslint-disable */
// Worker binding types. Regenerate when configuring a deployment.
interface __BaseEnv_Env {
	NEBIUS_IP_RATE_LIMITER: RateLimit;
	NEBIUS_VERSION: WorkerVersionMetadata;
	NEBIUS_ENABLED: "false";
	NEBIUS_EXECUTION_ENABLED: "false";
	NEBIUS_ALLOWED_ORIGIN: string;
	NEBIUS_MODEL_ROUTINE: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
	NEBIUS_MODEL_REASONING: "nvidia/nemotron-3-super-120b-a12b";
	NEBIUS_DAILY_CALL_LIMIT: "20";
	NEBIUS_DAILY_RUN_LIMIT: "3";
	NEBIUS_SANDBOX_PROJECT_ID: string;
	NEBIUS_SANDBOX_NODE_IMAGE_UUID: string;
	NEBIUS_BUDGET: DurableObjectNamespace<import("./index").NebiusBudget>;
	NEBIUS_RUN_BUDGET: DurableObjectNamespace<import("./index").NebiusRunBudget>;
	NEBIUS_RUNS: DurableObjectNamespace<import("./index").NebiusRun>;
}
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./index");
		durableNamespaces: "NebiusBudget" | "NebiusRunBudget" | "NebiusRun";
	}
	interface Env extends __BaseEnv_Env {}
}
interface Env extends __BaseEnv_Env {}
type StringifyValues<EnvType extends Record<string, unknown>> = {
	[Binding in keyof EnvType]: EnvType[Binding] extends string ? EnvType[Binding] : string;
};
declare namespace NodeJS {
	interface ProcessEnv extends StringifyValues<Pick<Cloudflare.Env, "NEBIUS_ENABLED" | "NEBIUS_EXECUTION_ENABLED" | "NEBIUS_ALLOWED_ORIGIN" | "NEBIUS_MODEL_ROUTINE" | "NEBIUS_MODEL_REASONING" | "NEBIUS_DAILY_CALL_LIMIT" | "NEBIUS_DAILY_RUN_LIMIT" | "NEBIUS_SANDBOX_PROJECT_ID" | "NEBIUS_SANDBOX_NODE_IMAGE_UUID">> {}
}
declare module "*.txt" {
	const value: string;
	export default value;
}
declare module "*.html" {
	const value: string;
	export default value;
}
declare module "*.sql" {
	const value: string;
	export default value;
}
declare module "*.bin" {
	const value: ArrayBuffer;
	export default value;
}
declare module "*.wasm" {
	const value: WebAssembly.Module;
	export default value;
}
declare module "*.wasm?module" {
	const value: WebAssembly.Module;
	export default value;
}