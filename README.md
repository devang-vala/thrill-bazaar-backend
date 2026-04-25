## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Docker

Build the production image:

```bash
docker build -t thrill-bazaar-backend .
```

Run it with your production environment variables:

```bash
docker run --rm -p 3000:3000 --env-file .env thrill-bazaar-backend
```

The container runs Prisma migrations first and then starts the API server.

## EC2 deployment

1. Create an RDS PostgreSQL database and allow inbound access from the EC2 security group.
2. Launch an EC2 instance with Docker installed.
3. Copy this backend folder to the instance or clone the repo there.
4. Create the production `.env` file with `DATABASE_URL`, `JWT_SECRET`, Cloudinary, SMS, Razorpay, and any optional Meilisearch values you use.
5. Build the image with `docker build -t thrill-bazaar-backend .`.
6. Start the container with `docker run -d --restart unless-stopped --name thrill-bazaar-backend -p 3000:3000 --env-file .env thrill-bazaar-backend`.
7. Put Nginx or an AWS load balancer in front of the container and terminate HTTPS there.

If you prefer to run migrations separately, you can use a one-off container with the same image and `npx prisma migrate deploy`, but the default container command already handles it.
