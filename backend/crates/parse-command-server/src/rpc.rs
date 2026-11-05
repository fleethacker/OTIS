use crate::{
    Error,
    api::{App, ReadRequest},
    proto::app::v1::*,
};
use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::sync::Arc;
pub struct Rpc(pub Arc<App>);
fn encoded<T: DeserializeOwned>(value: Value) -> ServiceResult<T> {
    Response::ok(
        serde_json::from_value(value).map_err(|_| {
            connectrpc::ConnectError::internal("Response contract validation failed")
        })?,
    )
}
impl Rpc {
    async fn identity(&self, ctx: &RequestContext) -> crate::Result<crate::api::Identity> {
        self.0
            .identity(
                ctx.header("cookie").and_then(|v| v.to_str().ok()),
                ctx.header("origin").and_then(|v| v.to_str().ok()),
                ctx.header("host").and_then(|v| v.to_str().ok()),
            )
            .await
    }
    async fn scope(&self, ctx: &RequestContext, key: &str) -> crate::Result<String> {
        let id = self.identity(ctx).await?;
        self.0.scope(key, &id.owner).await?;
        Ok(id.owner)
    }
}
#[allow(refining_impl_trait)]
impl AppService for Rpc {
    async fn health(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, HealthRequest>,
    ) -> ServiceResult<HealthResponse> {
        encoded(
            json!({"healthy":true,"message":"Rust application HTTP server is running; source readiness is reported separately"}),
        )
    }
    async fn info(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, InfoRequest>,
    ) -> ServiceResult<InfoResponse> {
        encoded(
            json!({"name":"Parse Command","version":env!("CARGO_PKG_VERSION"),"description":"Rust message intake, search and private-state backend"}),
        )
    }
    async fn get_identity(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, GetIdentityRequest>,
    ) -> ServiceResult<GetIdentityResponse> {
        let identity = self.identity(&ctx).await.map_err(Error::rpc)?;
        encoded(
            serde_json::to_value(identity)
                .map_err(|_| connectrpc::ConnectError::internal("Identity response"))?,
        )
    }
    async fn list_roles(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ListRolesRequest>,
    ) -> ServiceResult<ListRolesResponse> {
        self.identity(&ctx).await.map_err(Error::rpc)?;
        encoded(
            json!({"roles":[{"name":"admin","description":"Administrator"},{"name":"viewer","description":"Viewer"}]}),
        )
    }
}
#[allow(refining_impl_trait)]
impl SourceDataService for Rpc {
    async fn read_schedules(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ReadSchedulesRequest>,
    ) -> ServiceResult<ReadSchedulesResponse> {
        let identity = self.identity(&ctx).await.map_err(Error::rpc)?;
        let mut data = self
            .0
            .execute("list", ReadRequest::default(), &identity.owner)
            .await
            .map_err(Error::rpc)?;
        data["notice"] = json!(
            "First page of at most 20 canonical messages. Reminder counts cover this window; use Message records for browsing/search."
        );
        data.as_object_mut()
            .ok_or_else(|| connectrpc::ConnectError::internal("Read response"))?
            .remove("meta");
        encoded(data)
    }
}
#[allow(refining_impl_trait)]
impl DraftService for Rpc {
    async fn read_draft(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, ReadDraftRequest>,
    ) -> ServiceResult<ReadDraftResponse> {
        let owner = self
            .scope(&ctx, request.source_message_id)
            .await
            .map_err(Error::rpc)?;
        encoded(
            self.0
                .store()
                .map_err(Error::rpc)?
                .draft(&owner, request.source_message_id)
                .await
                .map_err(Error::rpc)?,
        )
    }
    async fn save_draft(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, SaveDraftRequest>,
    ) -> ServiceResult<SaveDraftResponse> {
        let owner = self
            .scope(&ctx, request.source_message_id)
            .await
            .map_err(Error::rpc)?;
        encoded(
            self.0
                .store()
                .map_err(Error::rpc)?
                .save_draft(&owner, request.source_message_id, request.text)
                .await
                .map_err(Error::rpc)?,
        )
    }
    async fn read_preparation(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, ReadPreparationRequest>,
    ) -> ServiceResult<PreparationState> {
        let owner = self
            .scope(&ctx, request.source_message_id)
            .await
            .map_err(Error::rpc)?;
        encoded(
            self.0
                .store()
                .map_err(Error::rpc)?
                .preparation(&owner, request.source_message_id)
                .await
                .map_err(Error::rpc)?,
        )
    }
    async fn save_preparation(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, SavePreparationRequest>,
    ) -> ServiceResult<PreparationState> {
        let owner = self
            .scope(&ctx, request.source_message_id)
            .await
            .map_err(Error::rpc)?;
        let (settings, _) = crate::settings::shared(&self.0.private.state)
            .await
            .map_err(Error::rpc)?;
        let mut fields: serde_json::Value = serde_json::from_str(request.fields_json)
            .map_err(|_| Error::invalid("Invalid acknowledgement fields").rpc())?;
        if !fields.is_object() {
            return Err(Error::invalid("Invalid acknowledgement fields").rpc());
        }
        fields["outgoing"] = serde_json::json!(settings.outgoing_command);
        fields["authority"] = serde_json::json!(settings.action_authority);
        let fields_json = fields.to_string();
        encoded(
            self.0
                .store()
                .map_err(Error::rpc)?
                .save_preparation(
                    &owner,
                    request.source_message_id,
                    &fields_json,
                    request.generate,
                )
                .await
                .map_err(Error::rpc)?,
        )
    }
    async fn record_acknowledgement(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, RecordAcknowledgementRequest>,
    ) -> ServiceResult<PreparationState> {
        let owner = self
            .scope(&ctx, request.source_message_id)
            .await
            .map_err(Error::rpc)?;
        encoded(
            self.0
                .store()
                .map_err(Error::rpc)?
                .acknowledge(
                    &owner,
                    request.source_message_id,
                    request.acknowledged,
                    request.confirmed_external,
                    request.note,
                    request.occurred_at,
                )
                .await
                .map_err(Error::rpc)?,
        )
    }
}

pub fn router(app: Arc<App>) -> connectrpc::Router {
    let rpc = Arc::new(Rpc(app));
    connectrpc::Router::new()
        .add_service::<_, AppServiceRegisterMarker>(rpc.clone())
        .add_service::<_, SourceDataServiceRegisterMarker>(rpc.clone())
        .add_service::<_, DraftServiceRegisterMarker>(rpc)
}
