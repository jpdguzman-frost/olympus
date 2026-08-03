/** Mongo connection lifecycle. */

import mongoose from 'mongoose';

export async function connectMongo(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log(`Mongo connected: ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
  return mongoose.connection;
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}
