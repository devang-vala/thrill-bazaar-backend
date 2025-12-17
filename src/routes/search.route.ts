import { Hono } from "hono";
import { search } from "../controllers/search.controller.js";

const searchRouter = new Hono();

searchRouter.get("/", search);

export default searchRouter;
