/** 运行快照与归档共用的包文件范围，排除运行环境及平台噪声。 */
export const ARCHIVE_EXCLUDES = new Set([
  ".DS_Store", "node_modules", "__pycache__", ".git", ".venv", "venv",
  ".pytest_cache", ".mypy_cache", ".ruff_cache",
]);
export const ARCHIVE_EXCLUDE_FILES = new Set(["_skillhub_meta.json"]);
export function isNoise(name: string): boolean {
  return ARCHIVE_EXCLUDES.has(name) || ARCHIVE_EXCLUDE_FILES.has(name) ||
    [".log", ".pyc", ".swp", ".tmp"].some((suffix) => name.endsWith(suffix));
}
