import { BaseError } from './base.error';

export interface ValidationErrorDetail {
    field: string;
    message: string;
    code: string;
}

export class ValidationError extends BaseError {
    constructor(message: string = 'Validation failed', details?: ValidationErrorDetail[]) {
        super(message, 400, 'VALIDATION_ERROR', details);
    }
}
