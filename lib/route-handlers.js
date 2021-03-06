class GenericRouteHandler {
  constructor({ ctx, res, Model, log, urlFor }) {
    this.ctx = ctx;
    this.res = res;
    this.log = log;
    this.Model = Model;
    this.urlFor = urlFor;
  }

  /**
   * Any handler that is performing a DB mutation
   * should return true from this and use the
   * `transacting` option in all its bookshelf operations
   * The active transaction will be stored in this._tx;
   * If you need to rollback, just throw an error.
   */
  get requiresTransaction() {
    return false;
  }

  useTransaction(tx) {
    this._tx = tx;
  }

  get name() {
    return this.constructor.name.replace(/RouteHandler$/, '').toLowerCase();
  }

  processParams(params) {
    this.params = params;
    return Promise.resolve(null);
  }

  handle() {
    throw new Error(`${this.constructor.name} did not implement handle()`);
  }
}

class IndexRouteHandler extends GenericRouteHandler {
  handle() {
    return this.Model.fetchAll().then((collection) => this.res.ok(collection));
  }
}

class CreateRouteHandler extends GenericRouteHandler {
  get requiresTransaction() {
    return true;
  }

  handle() {
    return new this.Model(this.params)
      .save({}, { transacting: this._tx })
      .then((saved) => {
        return this.res
          .withHeader('Location', this.urlFor(saved))
          .withBody(saved)
          .withStatus(201);
      });
  }
}

class ExistingResourceRouteHandler extends GenericRouteHandler {
  processParams(params) {
    super.processParams(params);
    return new this.Model({ id: params.id })
      .fetch()
      .then((r) => {
        this.ctx.resource = r;
      })
      .catch((err) => {
        this.log(err, 'red');
        return this.res.notFound();
      });
  }

  get resource() {
    return this.ctx.resource;
  }
}

class ShowRouteHandler extends ExistingResourceRouteHandler {
  handle() {
    return Promise.resolve(this.res.ok(this.resource));
  }
}

class ExistsRouteHandler extends GenericRouteHandler {
  processParams(params) {
    return new this.Model()
      .where('id', params.id)
      .count()
      .then((count) => (count ? this.res.ok() : this.res.notFound()));
  }

  handle() {
    return Promise.resolve(this.res.ok());
  }
}

class UpdateRouteHandler extends ExistingResourceRouteHandler {
  get requiresTransaction() {
    return true;
  }

  handle() {
    const safeParams = {
      ...this.params
    };
    delete safeParams.id;
    return this.resource
      .set(safeParams)
      .save(null, { transacting: this._tx })
      .then((r) => {
        return this.res.ok(r);
      });
  }
}

class DestroyRouteHandler extends ExistingResourceRouteHandler {
  get requiresTransaction() {
    return true;
  }

  handle() {
    return this.resource.destroy({ transacting: this._tx }).then(() => {
      return this.res.ok();
    });
  }
}

module.exports = {
  GenericRouteHandler,
  IndexRouteHandler,
  CreateRouteHandler,
  ShowRouteHandler,
  DestroyRouteHandler,
  ExistsRouteHandler,
  UpdateRouteHandler
};
