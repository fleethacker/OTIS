FROM opensearchproject/opensearch:3.9.0@sha256:3b55f6b6249cfdb92b52ee59adc8a266203ba9ef9f5d82544fad6f1af2f3609e
ARG TARGETARCH
ENV DJL_CACHE_DIR=/usr/share/opensearch/.djl.ai DJL_OFFLINE=true
COPY --chown=opensearch:opensearch assets/native/${TARGETARCH}/cache/ /usr/share/opensearch/.djl.ai/
COPY --chown=opensearch:opensearch opensearch/native-${TARGETARCH}.sha256 /tmp/native.sha256
COPY --chown=opensearch:opensearch assets/tokenizer.json /tmp/tokenizer.json
COPY --chown=opensearch:opensearch opensearch/PrimeInference.java /tmp/PrimeInference.java
# Model/native downloads belong to explicit connected preparation. Image
# assembly verifies the pinned CPU libraries and loads them without networking.
RUN --network=none cd /usr/share/opensearch/.djl.ai \
    && sha256sum -c /tmp/native.sha256 \
    && /usr/share/opensearch/jdk/bin/javac -cp '/usr/share/opensearch/plugins/opensearch-ml/*:/usr/share/opensearch/lib/*' /tmp/PrimeInference.java \
    && /usr/share/opensearch/jdk/bin/java -Dai.djl.offline=true \
      -cp '/tmp:/usr/share/opensearch/plugins/opensearch-ml/*:/usr/share/opensearch/lib/*' PrimeInference \
    && rm /tmp/PrimeInference.java /tmp/PrimeInference.class /tmp/native.sha256 /tmp/tokenizer.json
