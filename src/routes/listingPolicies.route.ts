import { Hono } from "hono";
import {
  getListingPolicies,
  getListingPolicyById,
  createListingPolicy,
  updateListingPolicy,
} from "../controllers/listingPolicies.controller.js";
import {
  authenticateToken,
  requireAnyAdmin,
} from "../middlewares/auth.middleware.js";

const listingPoliciesRouter = new Hono();

listingPoliciesRouter.use(authenticateToken);
listingPoliciesRouter.use(requireAnyAdmin);

listingPoliciesRouter.get("/seller/:sellerId", getListingPolicies);
listingPoliciesRouter.get("/:id", getListingPolicyById);
listingPoliciesRouter.post("/seller/:sellerId", createListingPolicy);
listingPoliciesRouter.put("/:id", updateListingPolicy);

export default listingPoliciesRouter;
