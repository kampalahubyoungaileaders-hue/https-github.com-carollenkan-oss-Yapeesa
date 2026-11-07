export interface paths {
  '/api/auth/recovery/code': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            phone: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              ok: boolean;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/recovery/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            phone: string;
            code: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              requires_mfa: boolean;
              mfa_verified: boolean;
              factors: {
                /** Format: uuid */
                id: string;
                name: string;
              }[];
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/recovery/mfa': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            factor_id: string;
            code: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              requires_mfa: boolean;
              mfa_verified: boolean;
              factors: {
                /** Format: uuid */
                id: string;
                name: string;
              }[];
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/recovery/complete': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            pin: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              ok: boolean;
              cleanup_complete: boolean;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/recovery/finish': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': Record<string, never>;
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              ok: boolean;
              cleanup_complete: boolean;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/recovery/cancel': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': Record<string, never>;
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              ok: boolean;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        502: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** @enum {string} */
              status: 'ok';
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/session': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              configured: boolean;
              user: {
                /** Format: uuid */
                person_id: string;
                display_name: string;
                requires_mfa: boolean;
                mfa_verified: boolean;
                can_administer: boolean;
                factors: {
                  /** Format: uuid */
                  id: string;
                  name: string;
                }[];
              } | null;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/invitation/code': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            phone: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              ok: boolean;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/invitation/accept': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            phone: string;
            pin: string;
            code: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              configured: boolean;
              user: {
                /** Format: uuid */
                person_id: string;
                display_name: string;
                requires_mfa: boolean;
                mfa_verified: boolean;
                can_administer: boolean;
                factors: {
                  /** Format: uuid */
                  id: string;
                  name: string;
                }[];
              } | null;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            phone: string;
            pin: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              configured: boolean;
              user: {
                /** Format: uuid */
                person_id: string;
                display_name: string;
                requires_mfa: boolean;
                mfa_verified: boolean;
                can_administer: boolean;
                factors: {
                  /** Format: uuid */
                  id: string;
                  name: string;
                }[];
              } | null;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        423: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              ok: boolean;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/mfa/enroll': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              id: string;
              secret: string;
              uri: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/mfa/verify': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            factor_id: string;
            code: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              configured: boolean;
              user: {
                /** Format: uuid */
                person_id: string;
                display_name: string;
                requires_mfa: boolean;
                mfa_verified: boolean;
                can_administer: boolean;
                factors: {
                  /** Format: uuid */
                  id: string;
                  name: string;
                }[];
              } | null;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/groups': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              id: string;
              name: string;
              currency: string;
              time_zone: string;
              country_code: string;
              minor_digits: number;
              can_record: boolean;
            }[];
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/groups/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              group: {
                /** Format: uuid */
                id: string;
                name: string;
                currency: string;
                time_zone: string;
                country_code: string;
                minor_digits: number;
                can_record: boolean;
                max_shares: string;
                can_preview_shareout: boolean;
              };
              cycle: {
                /** Format: uuid */
                id: string;
                starts_on: string;
                ends_on: string;
                share_price: string;
              } | null;
              members: {
                /** Format: uuid */
                id: string;
                name: string;
                active: boolean;
              }[];
              transactions: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                member_id: string;
                meeting_date: string;
                recorded_at: string;
                shares: string;
                amount: string;
                currency: string;
                /** Format: uuid */
                journal_id: string;
                calculation_mismatch: boolean;
                note: string;
                /** Format: uuid */
                reverses?: string | null;
              }[];
              journal_lines: {
                /** Format: uuid */
                journal_id: string;
                /** @enum {string} */
                account: 'cash' | 'share_capital';
                /** @enum {string} */
                side: 'debit' | 'credit';
                amount: string;
              }[];
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/groups/{id}/statement.pdf': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: {
          member_id?: string;
        };
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Share purchase statement */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/pdf': string;
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        404: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/groups/{id}/shares': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            member_id: string;
            /** Format: date */
            meeting_date: string;
            shares: string;
            client_id: string;
            /** Format: uuid */
            device_id: string;
            client_amount: string;
            client_calc_version: string;
            note: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              transaction_id: string;
              /** Format: uuid */
              journal_id: string;
              /** Format: uuid */
              client_id: string;
              amount: string;
              currency: string;
              calculation_mismatch: boolean;
              calc_version: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/groups/{id}/reversals': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            transaction_id: string;
            client_id: string;
            /** Format: uuid */
            device_id: string;
            reason: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              transaction_id: string;
              /** Format: uuid */
              journal_id: string;
              /** Format: uuid */
              client_id: string;
              amount: string;
              currency: string;
              calculation_mismatch: boolean;
              calc_version: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/groups/{id}/shareout-preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              cycle_id: string;
              currency: string;
              fund: string;
              total_shares: string;
              calc_version: string;
              /** @enum {string} */
              scope: 'recorded-shares-only';
              members: {
                /** Format: uuid */
                id: string;
                name: string;
                shares: string;
                amount: string;
              }[];
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/groups/{id}/meetings': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              can_approve: boolean;
              currency: string;
              can_record: boolean;
              meetings: {
                /** Format: uuid */
                id: string;
                date: string;
                /** @enum {string} */
                status: 'open' | 'closed';
                opening_cash: string | null;
                cash_in: string | null;
                cash_out: string | null;
                expected_cash: string | null;
                roster: {
                  /** Format: uuid */
                  id: string;
                  name: string;
                  /** @enum {string|null} */
                  status: 'present' | 'absent' | 'excused' | null;
                }[];
                proposal: {
                  /** Format: uuid */
                  id: string;
                  expected_cash: string;
                  counted_cash: string;
                  difference: string;
                  explanation: string;
                  stale: boolean;
                  approvals: {
                    /** Format: uuid */
                    person_id: string;
                    name: string;
                    eligible: boolean;
                  }[];
                } | null;
              }[];
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            request_id: string;
            /** Format: uuid */
            device_id: string;
            /** @enum {string} */
            action: 'open' | 'attendance' | 'propose' | 'approve';
            /** Format: date */
            date: string | null;
            /** Format: uuid */
            meeting_id: string | null;
            /** Format: uuid */
            member_id: string | null;
            /** @enum {string|null} */
            status: 'present' | 'absent' | 'excused' | null;
            counted_cash: string | null;
            explanation: string | null;
            /** Format: uuid */
            proposal_id: string | null;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              id: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/calculation-version': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              calc_version: string;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/admin/workspace': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              currencies: {
                code: string;
                minor_digits: number;
              }[];
              people: {
                /** Format: uuid */
                id: string;
                name: string;
                phone: string | null;
                has_login: boolean;
                staff_ready: boolean;
              }[];
              groups: {
                /** Format: uuid */
                id: string;
                name: string;
                country_code: string;
                currency: string;
                time_zone: string;
                max_shares: string;
                configuration_locked: boolean;
                cycle: {
                  /** Format: date */
                  starts_on: string;
                  /** Format: date */
                  ends_on: string;
                  share_price: string;
                } | null;
                memberships: {
                  /** Format: uuid */
                  person_id: string;
                  role: string;
                }[];
              }[];
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/admin/groups': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            request_id: string;
            /** Format: uuid */
            device_id: string;
            name: string;
            max_shares: string;
            /** Format: date */
            starts_on: string;
            /** Format: date */
            ends_on: string;
            share_price: string;
            country_code: string;
            currency: string;
            time_zone: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              id: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/admin/groups/{id}/settings': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            request_id: string;
            /** Format: uuid */
            device_id: string;
            name: string;
            max_shares: string;
            /** Format: date */
            starts_on: string;
            /** Format: date */
            ends_on: string;
            share_price: string;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              id: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/admin/groups/{id}/members': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            request_id: string;
            /** Format: uuid */
            device_id: string;
            /** Format: uuid */
            existing_person: string | null;
            name: string;
            phone: string | null;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              id: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/admin/groups/{id}/roles': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: {
          id: string;
        };
        cookie?: never;
      };
      requestBody: {
        content: {
          'application/json': {
            /** Format: uuid */
            request_id: string;
            /** Format: uuid */
            device_id: string;
            /** Format: uuid */
            person_id: string;
            /** @enum {string} */
            role: 'member' | 'secretary' | 'treasurer' | 'chair';
            enabled: boolean;
          };
        };
      };
      responses: {
        /** @description Default Response */
        200: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              /** Format: uuid */
              id: string;
            };
          };
        };
        /** @description Default Response */
        400: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        401: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        403: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        409: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        422: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        429: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
        /** @description Default Response */
        503: {
          headers: {
            [name: string]: unknown;
          };
          content: {
            'application/json': {
              error: string;
            };
          };
        };
      };
    };
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: never;
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
