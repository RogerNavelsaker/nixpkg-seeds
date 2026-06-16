const sourceRepo = Bun.env.SEEDS_SOURCE_REPO_URL ?? "https://github.com/jayminwest/seeds.git";
const sourceOwner = Bun.env.SEEDS_SOURCE_OWNER ?? "jayminwest";
const sourceName = Bun.env.SEEDS_SOURCE_REPO ?? "seeds";
const sourceBranch = Bun.env.SEEDS_SOURCE_BRANCH ?? "main";
const sourceHomepage = `https://github.com/${sourceOwner}/${sourceName}/tree/${sourceBranch}`;
const sourceIssues = `https://github.com/${sourceOwner}/${sourceName}/issues`;
const manifestPath = "nix/package-manifest.json";
const packageJsonPath = "package.json";

async function run(command: string[], cwd?: string) {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with ${exitCode}\n${stderr}`);
  return stdout.trim();
}

function nextPackageRevision(
  currentVersion: string | undefined,
  currentRevision: number | undefined,
  currentSourceRev: string | undefined,
  nextVersion: string,
  nextSourceRev: string,
) {
  if (currentVersion !== nextVersion) return 1;
  if (!currentSourceRev || currentSourceRev !== nextSourceRev)
    return Math.max(currentRevision ?? 0, 0) + 1;
  return currentRevision ?? 1;
}

const manifest = await Bun.file(manifestPath).json();
const packageJson = await Bun.file(packageJsonPath).json();
const tempDir = await run(["mktemp", "-d", `${Bun.env.TMPDIR ?? "/tmp"}/seeds-sync-XXXXXX`]);

try {
  await run(["git", "clone", "--depth", "1", "--branch", sourceBranch, sourceRepo, tempDir]);

  const sourcePackageJson = await Bun.file(`${tempDir}/package.json`).json();
  const sourceRev = await run(["git", "rev-parse", "HEAD"], tempDir);
  const binEntries = Object.entries(sourcePackageJson.bin ?? {});

  if (binEntries.length === 0)
    throw new Error(`No bin entry found in ${sourceOwner}/${sourceName}@${sourceBranch}`);

  const [binName, entrypoint] = binEntries[0] as [string, string];
  const prefetchHash = await run([
    "nix-prefetch-url",
    "--unpack",
    `https://github.com/${sourceOwner}/${sourceName}/archive/${sourceRev}.tar.gz`,
  ]);
  const sourceHash = await run(["nix", "hash", "to-sri", "--type", "sha256", prefetchHash.split("\n")[0]]);

  manifest.stubbed = false;
  manifest.package.packageRevision = nextPackageRevision(
    manifest.package.version,
    manifest.package.packageRevision,
    manifest.package.sourceRev,
    sourcePackageJson.version,
    sourceRev,
  );
  manifest.package.version = sourcePackageJson.version;
  manifest.package.sourceRev = sourceRev;
  manifest.package.sourceHash = sourceHash;
  manifest.binary.upstreamName = binName;
  manifest.binary.entrypoint = entrypoint;
  delete manifest.dist;
  delete manifest.deps;
  manifest.meta.description = sourcePackageJson.description ?? manifest.meta.description;
  manifest.meta.homepage = sourceHomepage;
  manifest.meta.licenseSpdx = sourcePackageJson.license ?? manifest.meta.licenseSpdx ?? "unfree";

  packageJson.name = sourcePackageJson.name ?? manifest.package.npmName;
  packageJson.version = sourcePackageJson.version;
  packageJson.description = sourcePackageJson.description ?? packageJson.description;
  packageJson.license = sourcePackageJson.license ?? packageJson.license;
  packageJson.type = sourcePackageJson.type ?? packageJson.type ?? "module";
  packageJson.repository = { type: "git", url: sourceRepo };
  packageJson.homepage = sourceHomepage;
  packageJson.bugs = { url: sourceIssues };
  packageJson.keywords = sourcePackageJson.keywords ?? [];
  packageJson.bin = sourcePackageJson.bin ?? {};
  packageJson.engines = sourcePackageJson.engines ?? {};
  packageJson.scripts = {
    "show-manifest": "bun --eval \"console.log(await Bun.file('nix/package-manifest.json').text())\"",
    "sync:source": "bun run sync:github-source",
    "sync:manifest": "bun run sync:github-source",
    "sync:github-source": "bun run scripts/sync-from-github.ts",
    "sync:npm-source": "bun run scripts/sync-from-npm.ts",
    "postinstall": "bun x bun2nix -o bun.nix",
  };
  packageJson.dependencies = sourcePackageJson.dependencies ?? {};
  packageJson.devDependencies = {
    ...sourcePackageJson.devDependencies,
    "@types/bun": packageJson.devDependencies?.["@types/bun"] ?? "^1.3.10",
    "bun2nix": "2.0.8",
  };
  delete packageJson.private;

  const sourceBunLock = Bun.file(`${tempDir}/bun.lock`);
  if (await sourceBunLock.exists()) {
    await Bun.write("bun.lock", await sourceBunLock.text());
  }

  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        version: manifest.package.version,
        packageRevision: manifest.package.packageRevision,
        sourceBranch,
        sourceRev,
        sourceHash,
      },
      null,
      2,
    ),
  );
} finally {
  await run(["rm", "-rf", tempDir]);
}
