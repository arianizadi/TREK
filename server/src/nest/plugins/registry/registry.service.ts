import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../../db/database';
import { pluginCodeDir, pluginsCodeRoot, pluginsDataRoot } from '../paths';
import { safeDownload, sha256Matches } from '../install/safe-fetch';
import { extractArchive } from '../install/safe-extract';
import { scanForNativeBinaries } from '../install/native-scan';
import { parseManifest } from '../install/manifest';
import { discoverPlugins } from '../install/discovery';

/**
 * TREK-side of the plugin registry (#plugins, M5). Fetches the single aggregated
 * dist/index.json (never per-plugin GitHub API calls — the HACS rate-limit
 * lesson), caches it briefly + soft-fails, and installs a pinned version through
 * the M4 pipeline: SSRF-safe download -> sha256 verify -> zip/tar-slip-safe
 * extract -> manifest re-validate -> native re-scan -> atomic move -> discover
 * (registers INACTIVE). Nothing executes on install; activation is separate.
 */

const REGISTRY_URL =
  process.env.TREK_PLUGIN_REGISTRY_URL ||
  'https://raw.githubusercontent.com/mauriceboe/TREK-Plugins/main/dist/index.json';
const CACHE_TTL = 30 * 60 * 1000;

interface RegistryVersion {
  version: string;
  gitTag: string;
  commitSha: string;
  downloadUrl: string;
  sha256: string;
  minTrekVersion: string;
  maxTrekVersion?: string | null;
  size?: number;
  apiVersion?: number;
  nativeModules?: boolean;
}
export interface RegistryEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  repo: string;
  homepage?: string;
  tags?: string[];
  type: string;
  reviewedAt?: string | null;
  versions: RegistryVersion[];
}
interface Registry {
  schemaVersion: number;
  generatedAt?: string;
  plugins: RegistryEntry[];
}

let _cache: { data: Registry; expiresAt: number } | null = null;

/** Test hook: drop the in-memory registry cache. */
export function __clearRegistryCacheForTests(): void {
  _cache = null;
}

export class RegistryError extends Error {}

@Injectable()
export class PluginRegistryService {
  /** Fetch the aggregated registry (cached, soft-fail, stale-serve). */
  async fetchRegistry(): Promise<Registry> {
    if (_cache && Date.now() < _cache.expiresAt) return _cache.data;
    try {
      const resp = await fetch(REGISTRY_URL, { headers: { 'User-Agent': 'TREK-Server' } });
      if (!resp.ok) throw new Error(`registry ${resp.status}`);
      const data = (await resp.json()) as Registry;
      if (!data || !Array.isArray(data.plugins)) throw new Error('malformed registry');
      _cache = { data, expiresAt: Date.now() + CACHE_TTL };
      return data;
    } catch {
      return _cache?.data ?? { schemaVersion: 1, plugins: [] };
    }
  }

  /** The browse list the admin UI renders (metadata only, no code). */
  async browse(): Promise<Array<Omit<RegistryEntry, 'versions'> & { latest: string | null; minTrekVersion: string | null }>> {
    const reg = await this.fetchRegistry();
    return reg.plugins.map((p) => {
      const latest = p.versions[0] ?? null;
      return {
        id: p.id, name: p.name, author: p.author, description: p.description, repo: p.repo,
        homepage: p.homepage, tags: p.tags, type: p.type, reviewedAt: p.reviewedAt ?? null,
        latest: latest?.version ?? null, minTrekVersion: latest?.minTrekVersion ?? null,
      };
    });
  }

  /** Install a pinned version from the registry. Returns the installed plugin id. */
  async install(id: string, version?: string): Promise<{ id: string; version: string }> {
    const reg = await this.fetchRegistry();
    const entry = reg.plugins.find((p) => p.id === id);
    if (!entry) throw new RegistryError(`plugin ${id} not in registry`);
    const ver = version ? entry.versions.find((v) => v.version === version) : entry.versions[0];
    if (!ver) throw new RegistryError(`version ${version ?? 'latest'} not found for ${id}`);

    // 1. SSRF-safe download + 2. sha256 verify
    const { bytes, sha256 } = await safeDownload(ver.downloadUrl, (ver.size ?? 50 * 1024 * 1024) + 4096);
    if (!sha256Matches(sha256, ver.sha256)) throw new RegistryError('integrity check failed (sha256 mismatch)');

    // 3. zip/tar-slip-safe extract to staging
    const staging = path.join(pluginsDataRoot(), '.staging', `${id}-${ver.version}-${Date.now()}`);
    try {
      extractArchive(bytes, staging);
      const pluginRoot = locateManifestDir(staging);
      if (!pluginRoot) throw new RegistryError('archive contains no trek-plugin.json');

      // 4. re-validate the bundled manifest + 5. native re-scan
      const manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(pluginRoot, 'trek-plugin.json'), 'utf8')));
      if (manifest.id !== id) throw new RegistryError(`manifest id "${manifest.id}" != "${id}"`);
      if (scanForNativeBinaries(pluginRoot).length) throw new RegistryError('artifact contains native binaries');

      // 6. atomic move into place
      const dest = pluginCodeDir(id);
      fs.mkdirSync(pluginsCodeRoot(), { recursive: true });
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(pluginRoot, dest);

      // 7. register INACTIVE (record provenance)
      discoverPlugins(db);
      db.prepare('UPDATE plugins SET source_repo = ?, source_commit = ?, sha256 = ?, reviewed_at = ? WHERE id = ?').run(
        entry.repo, ver.commitSha, ver.sha256, entry.reviewedAt ?? null, id,
      );
      return { id, version: ver.version };
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

/** The extracted plugin root: staging itself, or its single wrapper subdir (codeload archives wrap in {repo}-{sha}/). */
function locateManifestDir(staging: string): string | null {
  if (fs.existsSync(path.join(staging, 'trek-plugin.json'))) return staging;
  const subs = fs.existsSync(staging)
    ? fs.readdirSync(staging, { withFileTypes: true }).filter((d) => d.isDirectory())
    : [];
  for (const s of subs) {
    const p = path.join(staging, s.name);
    if (fs.existsSync(path.join(p, 'trek-plugin.json'))) return p;
  }
  return null;
}
