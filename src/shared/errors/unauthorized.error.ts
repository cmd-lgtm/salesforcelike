import { BaseError } from './base.error';

export class UnauthorizedError extends BaseError {
    constructor(message: string = 'Unauthorized', details?: unknown) {
        super(message, 401, 'UNAUTHORIZED', details);
    }
}
