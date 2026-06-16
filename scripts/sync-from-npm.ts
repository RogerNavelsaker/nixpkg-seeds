const manifestPath = "nix/package-manifest.json";
const manifest = await Bun.file(manifestPath).json();
const packageJsonPath = "package.json";
const packageJson = await Bun.file(packageJsonPath).json();

async function fetchRegistry(packageName: string) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.json();
}

const registry = await fetchRegistry(manifest.package.npmName);
const latestTag = registry["dist-tags"]?.latest;
if (!latestTag) throw new Error(`No latest dist-tag found for ${manifest.package.npmName}`);

const latest = registry.versions?.[latestTag];
if (!latest) throw new Error(`No version payload found for ${manifest.package.npmName}@${latestTag}`);

const binEntries = Object.entries(latest.bin ?? {});
if (binEntries.length === 0) throw new Error(`No bin entry found for ${manifest.package.npmName}@${latestTag}`);

const [binName, entrypoint] = binEntries[0] as [string, string];

manifest.stubbed = false;
manifest.package.version = latest.version;
manifest.binary.upstreamName = binName;
manifest.binary.entrypoint = entrypoint;
manifest.dist ??= {};
manifest.dist.url = latest.dist.tarball;
manifest.dist.hash = latest.dist.integrity;
manifest.meta.description = latest.description ?? manifest.meta.description;
manifest.meta.homepage = latest.homepage ?? registry.homepage ?? `https://www.npmjs.com/package/${manifest.package.npmName}`;
manifest.meta.licenseSpdx = latest.license ?? manifest.meta.licenseSpdx ?? "unfree";

delete manifest.deps;

packageJson.dependencies ??= {};
packageJson.dependencies[manifest.package.npmName] = latest.version;

await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await Bun.write(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(JSON.stringify({
  package: manifest.package.npmName,
  version: manifest.package.version,
  bin: manifest.binary.name,
}, null, 2));
