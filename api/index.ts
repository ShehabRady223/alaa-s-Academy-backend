import { app } from "../src/app";
import { connectDb } from "../src/config/db";

// Ensure DB is connected on serverless cold starts
export default async function handler(req: any, res: any) {
    await connectDb();
    return app(req, res);
}