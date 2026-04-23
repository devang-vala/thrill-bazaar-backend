import { prisma } from "../db.js";

const normalizeSelectedDates = (selectedDates: unknown) => {
  if (!Array.isArray(selectedDates)) return [] as string[];

  return selectedDates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort();
};

export const getActiveSlotReservationHoldCounts = async (slotIds: string[]) => {
  if (slotIds.length === 0) return new Map<string, number>();

  const reservations = await prisma.bookingReservation.findMany({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { gt: new Date() },
      listingSlotId: { in: slotIds },
    },
    select: {
      listingSlotId: true,
      participantCount: true,
    },
  });

  const counts = new Map<string, number>();
  for (const reservation of reservations) {
    if (!reservation.listingSlotId) continue;
    counts.set(
      reservation.listingSlotId,
      (counts.get(reservation.listingSlotId) || 0) + (reservation.participantCount || 0),
    );
  }

  return counts;
};

export const getActiveDateReservationHoldCounts = async (dateRangeIds: string[]) => {
  if (dateRangeIds.length === 0) return new Map<string, number>();

  const reservations = await prisma.bookingReservation.findMany({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { gt: new Date() },
      dateRangeId: { in: dateRangeIds },
    },
    select: {
      dateRangeId: true,
      selectedDate: true,
      selectedDates: true,
      participantCount: true,
    },
  });

  const counts = new Map<string, number>();

  for (const reservation of reservations) {
    if (!reservation.dateRangeId) continue;

    const selectedDates = normalizeSelectedDates(reservation.selectedDates);
    const dateKeys =
      selectedDates.length > 0
        ? selectedDates
        : reservation.selectedDate
          ? [reservation.selectedDate.toISOString().split("T")[0]]
          : [];

    for (const dateKey of dateKeys) {
      const compoundKey = `${reservation.dateRangeId}:${dateKey}`;
      counts.set(compoundKey, (counts.get(compoundKey) || 0) + (reservation.participantCount || 0));
    }
  }

  return counts;
};
