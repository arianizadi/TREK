import { assignmentReorderRequestSchema } from '../assignment/assignment.schema';
import { budgetCreateItemRequestSchema, budgetUpdateItemRequestSchema } from '../budget/budget.schema';
import { collabPollCreateRequestSchema } from '../collab/collab.schema';
import { dayNoteCreateRequestSchema, dayNoteUpdateRequestSchema, dayUpdateRequestSchema } from '../day/day.schema';
import { packingCreateItemRequestSchema, packingUpdateItemRequestSchema } from '../packing/packing.schema';
import { placeCreateRequestSchema, placeUpdateRequestSchema } from '../place/place.schema';
import { reservationCreateRequestSchema, reservationUpdateRequestSchema } from '../reservation/reservation.schema';

import { z } from 'zod';

/**
 * AI copilot contract. The model may draft plans, but only this typed operation
 * set can be confirmed and applied by the server. Each apply path must still
 * re-check trip access and the matching TREK permission.
 */

export const aiUsageSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  reasoning_tokens: z.number().optional(),
  cost: z.number().optional(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

const operationBase = {
  id: z.string().min(1).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  warning: z.string().optional(),
};

export const aiCreatePlaceOperationSchema = z.object({
  ...operationBase,
  type: z.literal('create_place'),
  data: placeCreateRequestSchema,
  assignToDayId: z.union([z.number(), z.string()]).optional(),
  assignmentNotes: z.string().nullable().optional(),
});

export const aiUpdatePlaceOperationSchema = z.object({
  ...operationBase,
  type: z.literal('update_place'),
  placeId: z.union([z.number(), z.string()]),
  data: placeUpdateRequestSchema,
});

export const aiDeletePlaceOperationSchema = z.object({
  ...operationBase,
  type: z.literal('delete_place'),
  placeId: z.union([z.number(), z.string()]),
});

export const aiAssignPlaceToDayOperationSchema = z.object({
  ...operationBase,
  type: z.literal('assign_place_to_day'),
  dayId: z.union([z.number(), z.string()]),
  placeId: z.union([z.number(), z.string()]).optional(),
  placeOperationId: z.string().optional(),
  notes: z.string().nullable().optional(),
});

export const aiUnassignPlaceOperationSchema = z.object({
  ...operationBase,
  type: z.literal('unassign_place'),
  assignmentId: z.union([z.number(), z.string()]),
});

export const aiMoveAssignmentOperationSchema = z.object({
  ...operationBase,
  type: z.literal('move_assignment'),
  assignmentId: z.union([z.number(), z.string()]),
  toDayId: z.union([z.number(), z.string()]),
  orderIndex: z.number().optional(),
});

export const aiSetAssignmentTimeOperationSchema = z.object({
  ...operationBase,
  type: z.literal('set_assignment_time'),
  assignmentId: z.union([z.number(), z.string()]),
  time: z.string().max(40).nullable().optional(),
  endTime: z.string().max(40).nullable().optional(),
});

export const aiReorderItineraryOperationSchema = z.object({
  ...operationBase,
  type: z.literal('reorder_itinerary'),
  dayId: z.union([z.number(), z.string()]),
  orderedIds: assignmentReorderRequestSchema.shape.orderedIds,
});

export const aiAddDayNoteOperationSchema = z.object({
  ...operationBase,
  type: z.literal('add_day_note'),
  dayId: z.union([z.number(), z.string()]),
  data: dayNoteCreateRequestSchema,
});

export const aiUpdateDayNoteOperationSchema = z.object({
  ...operationBase,
  type: z.literal('update_day_note'),
  noteId: z.union([z.number(), z.string()]),
  dayId: z.union([z.number(), z.string()]),
  data: dayNoteUpdateRequestSchema,
});

export const aiDeleteDayNoteOperationSchema = z.object({
  ...operationBase,
  type: z.literal('delete_day_note'),
  noteId: z.union([z.number(), z.string()]),
  dayId: z.union([z.number(), z.string()]),
});

export const aiUpdateDayOperationSchema = z.object({
  ...operationBase,
  type: z.literal('update_day'),
  dayId: z.union([z.number(), z.string()]),
  data: dayUpdateRequestSchema,
});

export const aiCreateBudgetItemOperationSchema = z.object({
  ...operationBase,
  type: z.literal('create_budget_item'),
  data: budgetCreateItemRequestSchema,
});

export const aiUpdateBudgetItemOperationSchema = z.object({
  ...operationBase,
  type: z.literal('update_budget_item'),
  itemId: z.union([z.number(), z.string()]),
  data: budgetUpdateItemRequestSchema,
});

export const aiDeleteBudgetItemOperationSchema = z.object({
  ...operationBase,
  type: z.literal('delete_budget_item'),
  itemId: z.union([z.number(), z.string()]),
});

export const aiCreatePackingItemOperationSchema = z.object({
  ...operationBase,
  type: z.literal('create_packing_item'),
  data: packingCreateItemRequestSchema,
});

export const aiUpdatePackingItemOperationSchema = z.object({
  ...operationBase,
  type: z.literal('update_packing_item'),
  itemId: z.union([z.number(), z.string()]),
  data: packingUpdateItemRequestSchema,
});

export const aiDeletePackingItemOperationSchema = z.object({
  ...operationBase,
  type: z.literal('delete_packing_item'),
  itemId: z.union([z.number(), z.string()]),
});

export const aiCreatePollOperationSchema = z.object({
  ...operationBase,
  type: z.literal('create_poll'),
  data: collabPollCreateRequestSchema,
});

export const aiImportReservationOperationSchema = z.object({
  ...operationBase,
  type: z.literal('import_reservation'),
  data: reservationCreateRequestSchema,
});

export const aiUpdateReservationOperationSchema = z.object({
  ...operationBase,
  type: z.literal('update_reservation'),
  reservationId: z.union([z.number(), z.string()]),
  data: reservationUpdateRequestSchema,
});

export const aiDeleteReservationOperationSchema = z.object({
  ...operationBase,
  type: z.literal('delete_reservation'),
  reservationId: z.union([z.number(), z.string()]),
});

export const aiActionOperationSchema = z.discriminatedUnion('type', [
  aiCreatePlaceOperationSchema,
  aiUpdatePlaceOperationSchema,
  aiDeletePlaceOperationSchema,
  aiAssignPlaceToDayOperationSchema,
  aiUnassignPlaceOperationSchema,
  aiMoveAssignmentOperationSchema,
  aiSetAssignmentTimeOperationSchema,
  aiReorderItineraryOperationSchema,
  aiAddDayNoteOperationSchema,
  aiUpdateDayNoteOperationSchema,
  aiDeleteDayNoteOperationSchema,
  aiUpdateDayOperationSchema,
  aiCreateBudgetItemOperationSchema,
  aiUpdateBudgetItemOperationSchema,
  aiDeleteBudgetItemOperationSchema,
  aiCreatePackingItemOperationSchema,
  aiUpdatePackingItemOperationSchema,
  aiDeletePackingItemOperationSchema,
  aiCreatePollOperationSchema,
  aiImportReservationOperationSchema,
  aiUpdateReservationOperationSchema,
  aiDeleteReservationOperationSchema,
]).superRefine((operation, ctx) => {
  if (
    operation.type === 'assign_place_to_day' &&
    operation.placeId == null &&
    !operation.placeOperationId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['placeId'],
      message: 'placeId or placeOperationId is required',
    });
  }
});
export type AiActionOperation = z.infer<typeof aiActionOperationSchema>;

export const aiActionPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  assumptions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  alternatives: z.array(z.string()).default([]),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  operations: z.array(aiActionOperationSchema).max(25).default([]),
  usage: aiUsageSchema.optional(),
  expiresAt: z.number().optional(),
  serverSignature: z.string().optional(),
});
export type AiActionPlan = z.infer<typeof aiActionPlanSchema>;

export const aiChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(12000),
});
export type AiChatMessage = z.infer<typeof aiChatMessageSchema>;

export const aiDiscoveredPlaceSchema = z.object({
  google_place_id: z.string().nullable().optional(),
  google_ftid: z.string().nullable().optional(),
  osm_id: z.string().nullable().optional(),
  name: z.string().min(1).max(240),
  address: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  types: z.array(z.string().max(80)).max(20).optional(),
  source: z.string().max(40).optional(),
});
export type AiDiscoveredPlace = z.infer<typeof aiDiscoveredPlaceSchema>;

export const aiContextSchema = z.object({
  selectedDayId: z.union([z.number(), z.string()]).nullable().optional(),
  activeTab: z.string().optional(),
  discoveredPlaces: z.array(aiDiscoveredPlaceSchema).max(20).optional(),
});
export type AiContext = z.infer<typeof aiContextSchema>;

export const aiChatRequestSchema = z.object({
  tripId: z.union([z.number(), z.string()]),
  messages: z.array(aiChatMessageSchema).min(1).max(20),
  context: aiContextSchema.optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
});
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const aiActionPreviewRequestSchema = z.object({
  tripId: z.union([z.number(), z.string()]),
  prompt: z.string().min(1).max(8000),
  context: aiContextSchema.optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
});
export type AiActionPreviewRequest = z.infer<typeof aiActionPreviewRequestSchema>;

export const aiActionApplyRequestSchema = z.object({
  tripId: z.union([z.number(), z.string()]),
  plan: aiActionPlanSchema,
  confirmedOperationIds: z.array(z.string()).min(1).max(25).optional(),
});
export type AiActionApplyRequest = z.infer<typeof aiActionApplyRequestSchema>;

export const aiActionUndoOperationSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.enum([
    'delete_created_place',
    'restore_updated_place',
    'recreate_place',
    'delete_assignment',
    'recreate_assignment',
    'restore_moved_assignment',
    'restore_assignment_time',
    'restore_itinerary_order',
    'delete_day_note',
    'restore_updated_day_note',
    'recreate_day_note',
    'restore_updated_day',
    'delete_budget_item',
    'restore_updated_budget_item',
    'recreate_budget_item',
    'delete_packing_item',
    'restore_updated_packing_item',
    'recreate_packing_item',
    'delete_poll',
    'delete_reservation',
    'restore_updated_reservation',
    'recreate_reservation',
  ]),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type AiActionUndoOperation = z.infer<typeof aiActionUndoOperationSchema>;

export const aiActionUndoPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  operations: z.array(aiActionUndoOperationSchema).max(50).default([]),
  expiresAt: z.number().optional(),
  serverSignature: z.string().optional(),
});
export type AiActionUndoPlan = z.infer<typeof aiActionUndoPlanSchema>;

export const aiActionApplyResultSchema = z.object({
  success: z.boolean(),
  applied: z.array(z.object({
    operationId: z.string(),
    type: z.string(),
    result: z.unknown().optional(),
  })),
  skipped: z.array(z.object({
    operationId: z.string(),
    type: z.string(),
    reason: z.string(),
  })),
  undo: aiActionUndoPlanSchema.optional(),
});
export type AiActionApplyResult = z.infer<typeof aiActionApplyResultSchema>;

export const aiActionUndoRequestSchema = z.object({
  tripId: z.union([z.number(), z.string()]),
  undo: aiActionUndoPlanSchema,
});
export type AiActionUndoRequest = z.infer<typeof aiActionUndoRequestSchema>;

export const aiActionUndoResultSchema = z.object({
  success: z.boolean(),
  undone: z.array(z.object({
    operationId: z.string(),
    type: z.string(),
  })),
  skipped: z.array(z.object({
    operationId: z.string(),
    type: z.string(),
    reason: z.string(),
  })),
});
export type AiActionUndoResult = z.infer<typeof aiActionUndoResultSchema>;

export const aiTestConnectionRequestSchema = z.object({
  provider: z.literal('openrouter').optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
});
export type AiTestConnectionRequest = z.infer<typeof aiTestConnectionRequestSchema>;

export const aiTestConnectionResponseSchema = z.object({
  ok: z.boolean(),
  provider: z.literal('openrouter'),
  model: z.string(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  supportsReasoning: z.boolean(),
  supportsStructuredOutputs: z.boolean(),
  message: z.string().optional(),
});
export type AiTestConnectionResponse = z.infer<typeof aiTestConnectionResponseSchema>;
