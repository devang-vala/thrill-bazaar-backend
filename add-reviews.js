const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function addReviewsData() {
  try {
    const listingId = '41147c38-0dff-4d96-a18d-4865b551c4f6';
    const customerIds = [
      'b174a6c3-0d3c-41ad-979f-26003c6b0e4f',
      'baa7f1a2-301f-49e5-840e-e40c16f9b4c9',
      '1600d6df-68c3-45b5-bfaa-ec2fa20cba48',
      '63d9def2-72ef-4604-a88c-5d62ae25ca07',
      '88fb9d10-0d35-47c7-b1e2-c6ba0474a113'
    ];

    // 1. Find the operator for this listing
    console.log('Finding listing operator...');
    const listing = await prisma.listing.findFirst({
      where: { id: listingId },
      select: { operatorId: true }
    });

    if (!listing) {
      throw new Error('Listing not found');
    }

    const operatorId = listing.operatorId;
    console.log('Operator ID:', operatorId);

    // 2. Create 5 bookings
    console.log('Creating bookings...');
    const bookingIds = [];

    for (let i = 0; i < 5; i++) {
      const booking = await prisma.booking.create({
        data: {
          bookingReference: `TB${Date.now()}${i}`,
          customerId: customerIds[i],
          listingSlotId: null, // We'll use date range instead
          dateRangeId: null,   // For simplicity, we'll leave both null
          bookingStartDate: new Date('2024-01-01'),
          bookingEndDate: new Date('2024-01-01'),
          participantCount: 2,
          totalDays: 1,
          basePrice: 100.00,
          totalAmount: 100.00,
          bookingStatus: 'CONFIRMED'
        }
      });
      bookingIds.push(booking.id);
      console.log(`Created booking ${i + 1}: ${booking.id}`);
    }

    // 3. Create 5 reviews
    console.log('Creating reviews...');
    const reviewsData = [
      {
        rating: 5,
        title: 'Absolutely incredible experience!',
        text: 'Amazing adventure! The guides were professional and made me feel safe throughout the entire experience. The scenery was breathtaking and I got some incredible photos. Definitely worth every penny and I would do it again in a heartbeat!',
        images: [
          'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1464822759844-d150baec843b?w=400&h=400&fit=crop'
        ],
        helpfulCount: 3,
        createdAt: new Date('2024-02-15T14:30:00')
      },
      {
        rating: 4,
        title: 'Great value for money',
        text: 'Had a fantastic time! The equipment was in good condition and the staff were knowledgeable. Only minor complaint is that it felt a bit rushed at times, but overall a great experience that I would recommend to friends.',
        images: [
          'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop'
        ],
        helpfulCount: 2,
        createdAt: new Date('2024-01-28T16:45:00')
      },
      {
        rating: 5,
        title: 'Best adventure of my life!',
        text: 'This was hands down the most thrilling and well-organized adventure I have ever been on. The instructors were expertly trained, safety was clearly the top priority, and the views were absolutely stunning. Cannot wait to book another trip!',
        images: [
          'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1464822759844-d150baec843b?w=400&h=400&fit=crop'
        ],
        helpfulCount: 5,
        createdAt: new Date('2024-01-10T11:20:00')
      },
      {
        rating: 4,
        title: 'Solid experience with great guides',
        text: 'Really enjoyed this adventure! The guides were friendly and clearly experienced. Weather was perfect and we saw some amazing wildlife along the way. Would have loved a bit more time at the scenic spots but understand the schedule constraints.',
        images: [
          'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop'
        ],
        helpfulCount: 1,
        createdAt: new Date('2023-12-22T09:15:00')
      },
      {
        rating: 5,
        title: 'Perfect family adventure!',
        text: 'Took my teenage kids on this adventure and we all had an absolute blast! The staff were patient with the kids and made sure everyone felt comfortable and safe. Great photos, amazing memories, and we are already planning our next booking. Highly recommend for families!',
        images: [
          'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1464822759844-d150baec843b?w=400&h=400&fit=crop',
          'https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&h=400&fit=crop'
        ],
        helpfulCount: 4,
        createdAt: new Date('2023-11-18T13:45:00')
      }
    ];

    for (let i = 0; i < 5; i++) {
      const review = await prisma.review.create({
        data: {
          bookingId: bookingIds[i],
          listingId: listingId,
          customerId: customerIds[i],
          operatorId: operatorId,
          rating: reviewsData[i].rating,
          reviewTitle: reviewsData[i].title,
          reviewText: reviewsData[i].text,
          reviewImages: reviewsData[i].images,
          helpfulCount: reviewsData[i].helpfulCount,
          createdAt: reviewsData[i].createdAt,
          updatedAt: reviewsData[i].createdAt
        }
      });
      console.log(`Created review ${i + 1}: ${review.id}`);
    }

    console.log('✅ Successfully created 5 bookings and 5 reviews!');
    console.log('🎉 You now have 6 total reviews for pagination testing!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addReviewsData();