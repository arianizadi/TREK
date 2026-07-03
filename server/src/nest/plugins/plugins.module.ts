import { Module } from '@nestjs/common';
import { PluginsController } from './plugins.controller';
import { PluginsService } from './plugins.service';

/**
 * Plugin system (#plugins). M0 registers only the read side; the isolated
 * runtime supervisor, install pipeline and registry service are added in later
 * milestones under this same module.
 */
@Module({
  controllers: [PluginsController],
  providers: [PluginsService],
})
export class PluginsModule {}
