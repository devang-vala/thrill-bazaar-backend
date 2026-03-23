import { Hono } from "hono";
import {
  createSetting,
  deleteSetting,
  getSettingById,
  getSettings,
  updateSetting,
} from "../controllers/settings.controller.js";

const settingsRouter = new Hono();

settingsRouter.get("/", getSettings);
settingsRouter.get("/:id", getSettingById);
settingsRouter.post("/", createSetting);
settingsRouter.put("/:id", updateSetting);
settingsRouter.delete("/:id", deleteSetting);

export default settingsRouter;
