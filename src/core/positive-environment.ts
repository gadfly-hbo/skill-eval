import { createHash } from "node:crypto";

/** The same neutral task-resource boundary is appended to both controlled arms. */
export const POSITIVE_ENVIRONMENT_V2_VERSION = "positive-environment-v2";
export const POSITIVE_ENVIRONMENT_V2 = "仅使用当前消息和本会话系统明确提供的任务资源。当前工作区中的启动代码和模型配置（包括 .positive-worker.mts、.pi-home）是运行设施，不提供任务规则。不要搜索工作区祖先目录、仓库、宿主 HOME 或 SDK 来补充未提供的流程定义。系统显式列出的 skill 包及其包内依赖仍可按既有只读权限访问。若现有材料不足以确定所请求的流程，请在最终回答中如实说明缺失信息并结束工具探索，不猜测未提供的规则。";
export const POSITIVE_ENVIRONMENT_V2_SHA256 = createHash("sha256").update(POSITIVE_ENVIRONMENT_V2).digest("hex");
