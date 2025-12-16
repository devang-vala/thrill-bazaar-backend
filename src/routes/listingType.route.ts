import { Hono } from "hono";
import {
  getListingTypes,
  getListingType,
  createListingType,
  updateListingType,
  deleteListingType,
} from "../controllers/listingType.controller.js";

const listingTypeRoute = new Hono();

// Get all listing types
listingTypeRoute.get("/", getListingTypes);

// Get single listing type by ID
listingTypeRoute.get("/:id", getListingType);

// Create new listing type
listingTypeRoute.post("/", createListingType);

// Update listing type
listingTypeRoute.put("/:id", updateListingType);

// Delete listing type
listingTypeRoute.delete("/:id", deleteListingType);

export default listingTypeRoute;
