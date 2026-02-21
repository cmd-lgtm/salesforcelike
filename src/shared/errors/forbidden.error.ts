import { BaseError } from './base.error';

export class ForbiddenError extends BaseError {
    constructor(message: string = 'Forbidden', details?: unknown) {
        super(message, 403, 'FORBIDDEN', details);
    }
}
