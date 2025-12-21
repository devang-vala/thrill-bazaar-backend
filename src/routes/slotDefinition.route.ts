import { Hono } from "hono";
import { createSlotDefinition, getSlotDefinitions, deleteSlotDefinition, updateSlotDefinition } from "../controllers/slotDefinition.controller.js";

const slotDefinitionRouter = new Hono();

// Create a slot definition for a listing's variant
slotDefinitionRouter.post("/definitions", createSlotDefinition);

// Edit a slot definition by id
slotDefinitionRouter.put("/definitions", updateSlotDefinition);

// Fetch slot definitions for a listing/variant
slotDefinitionRouter.get("/definitions/:listingId/:variantId?", getSlotDefinitions);

slotDefinitionRouter.delete("/definitions", deleteSlotDefinition);

export default slotDefinitionRouter;
