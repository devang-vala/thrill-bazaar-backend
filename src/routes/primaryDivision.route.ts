import { Hono } from "hono";
import {
  getPrimaryDivisions,
  getPrimaryDivision,
  createPrimaryDivision,
  updatePrimaryDivision,
  deletePrimaryDivision,
} from "../controllers/primaryDivision.controller.js";

const primaryDivisionRouter = new Hono();

// Get all primary divisions (with optional country_id filter)
primaryDivisionRouter.get("/", getPrimaryDivisions);

// Get primary division by ID
primaryDivisionRouter.get("/:id", getPrimaryDivision);

// Create new primary division
primaryDivisionRouter.post("/", createPrimaryDivision);

// Update primary division
primaryDivisionRouter.put("/:id", updatePrimaryDivision);

// Delete primary division
primaryDivisionRouter.delete("/:id", deletePrimaryDivision);

export default primaryDivisionRouter;
