import { Module } from '@nestjs/common';
import { AssignmentsService } from '../assignments/assignments.service';
import { BudgetService } from '../budget/budget.service';
import { CollabService } from '../collab/collab.service';
import { DayNotesService } from '../days/day-notes.service';
import { DaysService } from '../days/days.service';
import { MapsService } from '../maps/maps.service';
import { PackingService } from '../packing/packing.service';
import { PlacesService } from '../places/places.service';
import { ReservationsService } from '../reservations/reservations.service';
import { TripsService } from '../trips/trips.service';
import { AiRateLimitService } from './ai-rate-limit.service';
import { AiCopilotController, AdminAiController } from './ai-copilot.controller';
import { AiCopilotService } from './ai-copilot.service';
import { AiUsageService } from './ai-usage.service';
import { OpenRouterAiClient } from './openrouter-ai.client';

@Module({
  controllers: [AiCopilotController, AdminAiController],
  providers: [
    AiCopilotService,
    OpenRouterAiClient,
    AiRateLimitService,
    AiUsageService,
    TripsService,
    PlacesService,
    AssignmentsService,
    DayNotesService,
    DaysService,
    BudgetService,
    PackingService,
    MapsService,
    CollabService,
    ReservationsService,
  ],
})
export class AiModule {}
