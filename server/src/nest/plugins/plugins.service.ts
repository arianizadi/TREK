import { Injectable } from '@nestjs/common';
import { db } from '../../db/database';
import { pluginsEnabled } from '../../config';

/**
 * Read side of the plugin system (#plugins), M0 scaffold. Lists installed
 * plugins from the `plugins` registry table and reports whether the runtime is
 * enabled (TREK_PLUGINS_ENABLED). No execution here — the isolated runtime,
 * install pipeline and registry fetch land in later milestones.
 */

export interface PluginListItem {
  id: string;
  name: string;
  description: string | null;
  type: string;
  icon: string | null;
  version: string | null;
  status: string;
  reviewed_at: string | null;
  source_repo: string | null;
}

@Injectable()
export class PluginsService {
  list(): { enabled: boolean; plugins: PluginListItem[] } {
    const plugins = db
      .prepare(
        `SELECT id, name, description, type, icon, version, status, reviewed_at, source_repo
         FROM plugins
         ORDER BY sort_order, name`,
      )
      .all() as PluginListItem[];
    return { enabled: pluginsEnabled(), plugins };
  }
}
