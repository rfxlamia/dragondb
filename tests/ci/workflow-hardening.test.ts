import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type WorkflowPermissions = Record<string, string>;

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  name?: string;
  permissions?: WorkflowPermissions;
  steps?: WorkflowStep[];
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
  on?: string | string[] | Record<string, unknown>;
  permissions?: WorkflowPermissions;
}

const WORKFLOWS_DIR = join(process.cwd(), ".github", "workflows");

function readWorkflow(fileName: string): {
  definition: WorkflowDefinition;
  source: string;
} {
  const source = readFileSync(join(WORKFLOWS_DIR, fileName), "utf8");
  return {
    definition: parse(source) as WorkflowDefinition,
    source,
  };
}

function hasPullRequestTrigger(trigger: WorkflowDefinition["on"]): boolean {
  if (trigger === "pull_request") return true;
  if (Array.isArray(trigger)) return trigger.includes("pull_request");
  return trigger !== null && typeof trigger === "object" && "pull_request" in trigger;
}

function expectLeastPrivilege(definition: WorkflowDefinition): void {
  expect(definition.permissions).toEqual({ contents: "read" });
  for (const job of Object.values(definition.jobs ?? {})) {
    expect(job.permissions).toBeUndefined();
  }
}

function combinedRun(job: WorkflowJob): string {
  return (job.steps ?? [])
    .map((step) => step.run ?? "")
    .join("\n")
    .trim();
}

function expectPinnedAction(job: WorkflowJob, action: string): WorkflowStep {
  const step = job.steps?.find((candidate) => candidate.uses?.startsWith(`${action}@`));
  expect(step?.uses).toMatch(new RegExp(`^${action}@[0-9a-f]{40}$`, "i"));
  return step ?? {};
}

function expectExactRun(job: WorkflowJob, name: string, command: string): void {
  expect(job.steps?.find((step) => step.name === name)?.run).toBe(command);
}

describe("CI workflow hardening", () => {
  it("gates frontend and Rust health independently", () => {
    const { definition } = readWorkflow("core.yml");

    expectLeastPrivilege(definition);
    expect(hasPullRequestTrigger(definition.on)).toBe(true);

    const frontend = definition.jobs?.frontend;
    const rust = definition.jobs?.rust;
    expect(frontend?.name).toBe("frontend/core");
    expect(rust?.name).toBe("rust");

    expectPinnedAction(frontend ?? {}, "actions/checkout");
    const bunSetup = expectPinnedAction(frontend ?? {}, "oven-sh/setup-bun");
    expect(bunSetup?.with?.["bun-version"]).toBe("1.3.14");

    expectExactRun(frontend ?? {}, "Install dependencies", "bun install --frozen-lockfile");
    expectExactRun(frontend ?? {}, "Typecheck", "bun run typecheck");
    expectExactRun(frontend ?? {}, "Lint", "bun run lint");
    expectExactRun(frontend ?? {}, "Test", "bun run test");
    expectExactRun(frontend ?? {}, "Build", "bun run build");

    expectPinnedAction(rust ?? {}, "actions/checkout");
    expectPinnedAction(rust ?? {}, "Swatinem/rust-cache");
    const rustCommands = combinedRun(rust ?? {});
    expectExactRun(
      rust ?? {},
      "Install Rust toolchain",
      "rustup toolchain install 1.96.0 --profile minimal --component clippy,rustfmt",
    );
    expectExactRun(rust ?? {}, "Check formatting", "cargo fmt --all -- --check");
    expectExactRun(rust ?? {}, "Run Clippy", "cargo clippy --locked --all-targets --all-features");
    expectExactRun(rust ?? {}, "Run Rust tests", "cargo test --locked");
    expectExactRun(rust ?? {}, "Check Rust compilation", "cargo check --locked");

    const prerequisites = [
      "libwebkit2gtk-4.1-dev",
      "build-essential",
      "curl",
      "wget",
      "file",
      "libxdo-dev",
      "libssl-dev",
      "libayatana-appindicator3-dev",
      "librsvg2-dev",
    ];
    for (const prerequisite of prerequisites) {
      expect(rustCommands).toContain(prerequisite);
    }

    const rustCache = rust?.steps?.find((step) => step.uses?.startsWith("Swatinem/rust-cache@"));
    expect(rustCache?.with?.workspaces).toBe("src-tauri -> target");
  });

  it("reviews dependency changes on pull requests", () => {
    const securityPath = join(WORKFLOWS_DIR, "security.yml");
    expect(existsSync(securityPath)).toBe(true);
    if (!existsSync(securityPath)) return;

    const { definition } = readWorkflow("security.yml");
    expectLeastPrivilege(definition);
    expect(hasPullRequestTrigger(definition.on)).toBe(true);
    const dependencyReview = definition.jobs?.["dependency-review"];
    expect(dependencyReview?.name).toBe("dependency-review");
    expectPinnedAction(dependencyReview ?? {}, "actions/checkout");
    expectPinnedAction(dependencyReview ?? {}, "actions/dependency-review-action");
  });

  it("keeps pinned GitHub Actions maintainable", () => {
    const dependabot = parse(
      readFileSync(join(process.cwd(), ".github", "dependabot.yml"), "utf8"),
    ) as {
      updates?: Array<{ "package-ecosystem"?: string }>;
      version?: number;
    };

    expect(dependabot.version).toBe(2);
    expect(
      dependabot.updates?.some((update) => update["package-ecosystem"] === "github-actions"),
    ).toBe(true);
  });

  it("keeps release packaging out of pull request workflows", () => {
    const workflowNames = readdirSync(WORKFLOWS_DIR).filter(
      (fileName) => fileName.endsWith(".yml") || fileName.endsWith(".yaml"),
    );

    for (const workflowName of workflowNames) {
      const workflowPath = join(WORKFLOWS_DIR, workflowName);
      if (!existsSync(workflowPath)) continue;

      const { definition, source } = readWorkflow(workflowName);
      if (!hasPullRequestTrigger(definition.on)) continue;

      expect(source).not.toMatch(/(?:cargo|bun run) tauri (?:build|bundle)/i);
      expect(source).not.toMatch(/tauri-apps\/tauri-action/i);
    }
  });
});
