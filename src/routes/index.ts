import { Hono } from "hono";
import listingBatchRouter from "./listingBatch.route.js";
import rentalInventoryRouter from "./rentalInventory.route.js";
import slotBasedRentalRouter from "./slotBasedRental.route.js";
import bookingRouter from "./booking.route.js";
import authRouter from "./auth.route.js";
import userRouter from "./user.route.js";
import listingTypeRouter from "./listingType.route.js";
import categoryRouter from "./category.route.js";
import subCategoryRouter from "./subCategory.route.js";
import listingRouter from "./listing.route.js";
import listingMediaRouter from "./listingMedia.route.js";
import listingVariantsRouter from "./listingVariants.route.js";
import listingContentRouter from "./listingContent.route.js";
import listingAddonsRouter from "./listingAddons.route.js";
import listingInclusionsExclusionsRouter from "./listingInclusionsExclusions.route.js";
import listingPoliciesRouter from "./listingPolicies.route.js";
import listingFaqRouter from "./listingFaq.route.js";
import fieldDefinitionsRouter from "./listingMetadataFieldDefinitions.route.js";
import fieldOptionsRouter from "./listingMetadataFieldOptions.route.js";
import variantFieldDefinitionsRouter from "./listingVariantMetadataFieldDefinitions.route.js";
import variantFieldOptionsRouter from "./listingVariantMetadataFieldOptions.route.js";
import uploadRouter from "./upload.route.js";
import inventoryDateRangesRouter from "./inventoryDateRanges.route.js";
import slotInventoryRouter from "./slotInventory.route.js";
import f3SlotInventoryRouter from "./f3SlotInventory.route.js";
import f2DateRangeRouter from "./f2DateRangeInventory.route.js";
import countryRouter from "./country.route.js";
import primaryDivisionRouter from "./primaryDivision.route.js";
import secondaryDivisionRouter from "./secondaryDivision.route.js";
import searchRouter from "./search.route.js";
import OperatorRouter from "./operator.route.js";
import slotDefinitionRouter from "./slotDefinition.route.js";
import rescheduleRouter from "./reschedule.route.js";


const router = new Hono();

// Test endpoint to verify API router is working
router.get("/", (c) => c.text("API root"));

// Mount auth routes
router.route("/auth", authRouter);

// Mount user routes
router.route("/user", userRouter);

// Mount listing type routes
router.route("/listing-types", listingTypeRouter);

// Mount category routes
router.route("/categories", categoryRouter);

// Mount sub-category routes
router.route("/sub-categories", subCategoryRouter);

// Mount listing routes
router.route("/listings", listingRouter);
router.route("/listing-media", listingMediaRouter);
router.route("/listing-variants", listingVariantsRouter);
router.route("/listing-content", listingContentRouter);
router.route("/listing-addons", listingAddonsRouter);
router.route(
  "/listing-inclusions-exclusions",
  listingInclusionsExclusionsRouter
);
router.route("/listing-policies", listingPoliciesRouter);
router.route("/listing-faqs", listingFaqRouter);
router.route("/field-definitions", fieldDefinitionsRouter);
router.route("/field-options", fieldOptionsRouter);
router.route("/variant-field-definitions", variantFieldDefinitionsRouter);
router.route("/variant-field-options", variantFieldOptionsRouter);
router.route("/upload", uploadRouter);


router.route("/listing-batch", listingBatchRouter);
router.route("/inventory-date-ranges", inventoryDateRangesRouter);
router.route("/slot-inventory", slotInventoryRouter);
router.route("/f3-slot-inventory", f3SlotInventoryRouter);
router.route("/f2-date-ranges", f2DateRangeRouter);

// Mount country and division routes
router.route("/countries", countryRouter);
router.route("/primary-divisions", primaryDivisionRouter);
router.route("/secondary-divisions", secondaryDivisionRouter);
// Mount rental inventory routes (F2)
router.route("/rental-inventory", rentalInventoryRouter);

// Mount slot-based rental routes (F4)
router.route("/slot-based-rental", slotBasedRentalRouter);

// Mount booking routes
router.route("/bookings", bookingRouter);

// Mount search routes
router.route("/search", searchRouter);

// Mount operator routes
router.route("/operators", OperatorRouter);

router.route("/slot-definitions", slotDefinitionRouter);

// Mount reschedule routes
router.route("/reschedules", rescheduleRouter);

export default router;
