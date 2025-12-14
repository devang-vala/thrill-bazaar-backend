import { Hono } from "hono";
import {
  getSecondaryDivisions,
  getSecondaryDivision,
  createSecondaryDivision,
  updateSecondaryDivision,
  deleteSecondaryDivision,
} from "../controllers/secondaryDivision.controller.js";

const secondaryDivisionRouter = new Hono();

// Get all secondary divisions (with optional primary_division_id filter)
secondaryDivisionRouter.get("/", getSecondaryDivisions);

// Get secondary division by ID
secondaryDivisionRouter.get("/:id", getSecondaryDivision);

// Create new secondary division
secondaryDivisionRouter.post("/", createSecondaryDivision);

// Update secondary division
secondaryDivisionRouter.put("/:id", updateSecondaryDivision);

// Delete secondary division
secondaryDivisionRouter.delete("/:id", deleteSecondaryDivision);

export default secondaryDivisionRouter;
