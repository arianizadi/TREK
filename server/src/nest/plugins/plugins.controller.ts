import { Controller, Get, UseGuards } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

/**
 * /api/admin/plugins — admin-only plugin control surface (#plugins).
 *
 * M0 scaffold: read-only listing + the runtime-enabled flag. Install, activate,
 * disable, uninstall and the registry browser are added in later milestones.
 * Admin-gated like the rest of /api/admin. The proxy namespace /api/plugins/:id
 * is reserved for the (future) runtime and is intentionally NOT part of this
 * admin controller.
 */
@Controller('api/admin/plugins')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get()
  list() {
    return this.plugins.list();
  }
}
