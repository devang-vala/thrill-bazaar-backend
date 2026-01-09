# Postman Testing Guide: Reschedule Functionality

This guide walks you through testing the new reschedule workflows for different booking formats (F1, F2, F3, F4).

> **Base URL**: `http://localhost:6969/api` (Adjust port if different)

## Prerequisites

1.  **Authentication**: You need to be logged in.
    -   **Customer Token**: For initiating requests.
    -   **Admin Token**: For reviewing/approving requests.
    -   *Tip*: Use `POST /auth/login` to get these tokens.

2.  **Existing Booking**: You need a valid `bookingId` for a booking that is NOT cancelled.

---

## Workflow 1: Initiate Reschedule (Customer/Operator)

**Endpoint**: `POST /reschedules/initiate`
**Headers**: `Authorization: Bearer <CUSTOMER_TOKEN>`

### 1. For F1 (Batches)
Use this if the booking is for a fixed batch (e.g., Trekking).

**Body (JSON)**:
```json
{
  "bookingId": "YOUR_BOOKING_ID_HERE",
  "rescheduleReason": "Something came up, need to change dates.",
  "newBatchId": "NEW_LISTING_SLOT_ID_HERE"
}
```

### 2. For F2 (Rentals)
Use this if the booking is a rental (e.g., Bike Rental).

**Body (JSON)**:
```json
{
  "bookingId": "YOUR_F2_BOOKING_ID_HERE",
  "rescheduleReason": "Need the bike next week instead.",
  "newRentalStartDate": "2025-01-20T10:00:00Z",
  "newRentalEndDate": "2025-01-22T10:00:00Z"
}
```

### 3. For F3 (Time Slots)
Use this for specific time slots (e.g., Paragliding at 10 AM).

**Body (JSON)**:
```json
{
  "bookingId": "YOUR_F3_BOOKING_ID_HERE",
  "rescheduleReason": "Weather constraints.",
  "newSlotId": "NEW_SLOT_ID_HERE"
}
```

### 4. For F4 (Date Ranges)
Use this for simple daily availability (e.g., Museum Entry).

**Body (JSON)**:
```json
{
  "bookingId": "YOUR_F4_BOOKING_ID_HERE",
  "rescheduleReason": "Plans changed.",
  "newDateRangeId": "NEW_INVENTORY_DATE_RANGE_ID_HERE"
}
```

> **Response**: You should get a `200 OK` with `success: true` and the `reschedule` object (status: "pending"). Copy the `id` from the response (this is the `rescheduleId`).

---

## Workflow 2: Admin Review (Admin Only)

**Endpoint**: `PUT /reschedules/:rescheduleId/review`
**Headers**: `Authorization: Bearer <ADMIN_TOKEN>`

### Option A: Approve Immediately
**Body (JSON)**:
```json
{
  "decision": "approved",
  "adminNotes": "Approved user request as per policy."
}
```
> **Effect**: The reschedule is processed immediately. The booking dates are updated.

### Option B: Approve with Fee
**Body (JSON)**:
```json
{
  "decision": "approved_with_charge",
  "rescheduleFeeAmount": 500,
  "adminNotes": "Approved but charging fee due to late notice."
}
```
> **Effect**: Status becomes `approved_with_charge`. The customer must now "pay" to complete the process (see Workflow 3).

### Option C: Reject
**Body (JSON)**:
```json
{
  "decision": "rejected",
  "adminNotes": "Requested dates are fully booked."
}
```

---

## Workflow 3: Complete Payment (If Approved with Charge)

**Endpoint**: `POST /reschedules/:rescheduleId/pay`
**Headers**: `Authorization: Bearer <CUSTOMER_TOKEN>`

Use this only if the status is `approved_with_charge`.

**Body (JSON)**:
```json
{
  "paymentMethod": "upi",
  "transactionId": "dummy_txn_123456"
}
```
> **Effect**: Payment is recorded, and the reschedule is finally processed.

---

## Verification Endpoints

### Get Booking History
Check if the reschedule appears in the booking's history.
- **GET** `/reschedules/booking/:bookingId`

### Get Pending Reschedules (Admin)
See all requests waiting for approval.
- **GET** `/reschedules/pending` (Requires Admin Token)

### Get Reschedule by ID
- **GET** `/reschedules/:rescheduleId`
