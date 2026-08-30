import { Router } from 'express';
import { parse, realtimeRideRequestSchema } from '../http/validation.js';
import { handleServiceRequest } from './serviceRequests.js';

export const rideRequestsRouter: Router = Router();

/**
 * POST /api/v1/ride-requests
 * Realtime rider-client endpoint. The server receipt time is the requested
 * pickup time, so only a veteran committed right now can be booked.
 */
rideRequestsRouter.post('/', async (req, res) => {
  const input = parse(realtimeRideRequestSchema, req.body);
  req.body = {
    serviceType: 'rides',
    requester: input.rider,
    pickupZip: input.currentAddress.zipCode,
    pickupAddress: input.currentAddress.address,
    destination: input.destinationAddress,
    durationMinutes: input.durationMinutes,
    maxDistanceKm: input.maxDistanceKm,
    autoBook: true,
    notes: input.notes,
  };
  await handleServiceRequest(req, res);
});
