import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export type DashboardCommand = "collect" | "analyze" | "report";

export interface CommandJob {
  id: string;
  slug: string;
  command: DashboardCommand;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  output: string[];
  exitCode?: number;
}

export interface CommandRunnerEvents {
  output: (job: CommandJob, line: string) => void;
  complete: (job: CommandJob) => void;
}

function appendStream(
  buffer: string,
  chunk: Buffer,
  onLine: (line: string) => void,
): string {
  const combined = `${buffer}${chunk.toString("utf8")}`;
  const parts = combined.split(/\r?\n/);
  const tail = parts.pop() ?? "";
  for (const line of parts) {
    if (line.length > 0) {
      onLine(line);
    }
  }
  return tail;
}

export class CommandRunner extends EventEmitter {
  private readonly jobs = new Map<string, CommandJob>();
  private readonly activeBySlug = new Map<string, string>();

  spawnCommand(slug: string, command: DashboardCommand): CommandJob {
    const activeId = this.activeBySlug.get(slug);
    if (activeId) {
      const activeJob = this.jobs.get(activeId);
      if (activeJob?.status === "running") {
        throw new Error("A command is already running for this repository.");
      }
    }

    const job: CommandJob = {
      id: randomUUID(),
      slug,
      command,
      status: "running",
      startedAt: new Date().toISOString(),
      output: [],
    };

    this.jobs.set(job.id, job);
    this.activeBySlug.set(slug, job.id);

    const child = spawn("pnpm", ["warden", command, "--repo", slug], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutTail = "";
    let stderrTail = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutTail = appendStream(stdoutTail, chunk, (line) => {
        job.output.push(line);
        this.emit("output", job, line);
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = appendStream(stderrTail, chunk, (line) => {
        const prefixed = `[stderr] ${line}`;
        job.output.push(prefixed);
        this.emit("output", job, prefixed);
      });
    });

    child.on("close", (exitCode) => {
      if (stdoutTail.length > 0) {
        job.output.push(stdoutTail);
        this.emit("output", job, stdoutTail);
      }
      if (stderrTail.length > 0) {
        const prefixed = `[stderr] ${stderrTail}`;
        job.output.push(prefixed);
        this.emit("output", job, prefixed);
      }

      job.status = exitCode === 0 ? "completed" : "failed";
      job.completedAt = new Date().toISOString();
      job.exitCode = exitCode ?? 1;
      this.activeBySlug.delete(slug);
      this.emit("complete", job);

      setTimeout(
        () => {
          this.jobs.delete(job.id);
        },
        10 * 60 * 1000,
      );
    });

    child.on("error", (error) => {
      const line = `[spawn-error] ${error.message}`;
      job.output.push(line);
      this.emit("output", job, line);
    });

    return job;
  }

  getJob(jobId: string): CommandJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  getLatestJobForSlug(slug: string): CommandJob | null {
    let latest: CommandJob | null = null;
    for (const job of this.jobs.values()) {
      if (job.slug !== slug) {
        continue;
      }
      if (!latest || job.startedAt > latest.startedAt) {
        latest = job;
      }
    }
    return latest;
  }

  isRunning(slug: string): boolean {
    const activeId = this.activeBySlug.get(slug);
    if (!activeId) {
      return false;
    }
    return this.jobs.get(activeId)?.status === "running";
  }
}
