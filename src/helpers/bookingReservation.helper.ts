import { prisma } from "../db.js";

type ReservationDelegate = {
  findMany: (args: unknown) => Promise<any[]>;
};

const getBookingReservationDelegate = (): ReservationDelegate | null => {
  const candidate = (prisma as unknown as { bookingReservation?: ReservationDelegate }).bookingReservation;
  return candidate && typeof candidate.findMany === "function" ? candidate : null;
};

const normalizeSelectedDates = (selectedDates: unknown) => {
  if (!Array.isArray(selectedDates)) return [] as string[];

  return selectedDates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort();
};

const toUtcStartOfDay = (dateValue: string) => new Date(`${dateValue}T00:00:00.000Z`);

const releaseExpiredReservations = async (input: {
  slotIds?: string[];
  dateRangeIds?: string[];
}) => {
  const bookingReservation = getBookingReservationDelegate();
  if (!bookingReservation) return;

  const slotIds = input.slotIds?.filter(Boolean) || [];
  const dateRangeIds = input.dateRangeIds?.filter(Boolean) || [];

  if (slotIds.length === 0 && dateRangeIds.length === 0) {
    return;
  }

  const expiredReservations = await bookingReservation.findMany({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { lte: new Date() },
      OR: [
        ...(slotIds.length > 0 ? [{ listingSlotId: { in: slotIds } }] : []),
        ...(dateRangeIds.length > 0 ? [{ dateRangeId: { in: dateRangeIds } }] : []),
      ],
    },
    select: {
      id: true,
      listingSlotId: true,
      dateRangeId: true,
      selectedDate: true,
      selectedDates: true,
      participantCount: true,
      inventoryReserved: true,
    },
  });

  if (expiredReservations.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const reservation of expiredReservations) {
      if (reservation.inventoryReserved) {
        if (reservation.listingSlotId) {
          await tx.listingSlot.update({
            where: { id: reservation.listingSlotId },
            data: {
              availableCount: {
                increment: reservation.participantCount || 0,
              },
            },
          });
        } else if (reservation.dateRangeId) {
          const selectedDates = normalizeSelectedDates(reservation.selectedDates);

          if (selectedDates.length > 0) {
            for (const selectedDate of selectedDates) {
              const slotChange = await tx.listingSlotChange.findFirst({
                where: {
                  inventoryDateRangeId: reservation.dateRangeId,
                  date: toUtcStartOfDay(selectedDate),
                },
                orderBy: { createdAt: "desc" },
              });

              if (slotChange) {
                await tx.listingSlotChange.update({
                  where: { id: slotChange.id },
                  data: {
                    availableCount: {
                      increment: reservation.participantCount || 0,
                    },
                    triggerType: "customer_cancel",
                  },
                });
              }
            }
          } else if (reservation.selectedDate) {
            const slotChange = await tx.listingSlotChange.findFirst({
              where: {
                inventoryDateRangeId: reservation.dateRangeId,
                date: reservation.selectedDate,
              },
              orderBy: { createdAt: "desc" },
            });

            if (slotChange) {
              await tx.listingSlotChange.update({
                where: { id: slotChange.id },
                data: {
                  availableCount: {
                    increment: reservation.participantCount || 0,
                  },
                  triggerType: "customer_cancel",
                },
              });
            }
          }
        }
      }

      await (tx as unknown as { bookingReservation: { update: (args: unknown) => Promise<unknown> } }).bookingReservation.update({
        where: { id: reservation.id },
        data: {
          status: "EXPIRED",
          releasedAt: new Date(),
          failureReason: "Reservation expired before payment.",
        },
      });
    }
  });
};

export const getActiveSlotReservationHoldCounts = async (slotIds: string[]) => {
  if (slotIds.length === 0) return new Map<string, number>();

  const bookingReservation = getBookingReservationDelegate();
  if (!bookingReservation) return new Map<string, number>();

  await releaseExpiredReservations({ slotIds });

  const reservations = await bookingReservation.findMany({
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

  const bookingReservation = getBookingReservationDelegate();
  if (!bookingReservation) return new Map<string, number>();

  await releaseExpiredReservations({ dateRangeIds });

  const reservations = await bookingReservation.findMany({
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
