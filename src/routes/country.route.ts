import { Hono } from "hono";
import {
  getCountries,
  getCountry,
  createCountry,
  updateCountry,
  deleteCountry,
} from "../controllers/country.controller.js";

const countryRouter = new Hono();

// Get all countries
countryRouter.get("/", getCountries);

// Get country by ID
countryRouter.get("/:id", getCountry);

// Create new country
countryRouter.post("/", createCountry);

// Update country
countryRouter.put("/:id", updateCountry);

// Delete country
countryRouter.delete("/:id", deleteCountry);

export default countryRouter;
