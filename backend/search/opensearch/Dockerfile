# syntax=docker/dockerfile:1
FROM opensearchproject/opensearch:3.9.0@sha256:3b55f6b6249cfdb92b52ee59adc8a266203ba9ef9f5d82544fad6f1af2f3609e AS opensaml-build
USER 0
ENV JAVA_HOME=/usr/share/opensearch/jdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"
WORKDIR /build
# Security 3.9.0.0: rebuild its dependency-only OpenSAML subproject with patched resolutions.
ADD --checksum=sha256:e702c90ae4e96564d444ce9db502215d8a769f54b66f53399cbd641864a674bf https://codeload.github.com/opensearch-project/security/tar.gz/3193d192d048a60fc8e63b3d172a7eb3dc9148a0 /tmp/security.tar.gz
RUN tar -xzf /tmp/security.tar.gz --strip-components=1
COPY opensearch/opensaml-dependencies.init.gradle opensearch/verify_opensaml_rebuild.py opensearch/dependencies.lock.json /tmp/rebuild/
# Upstream's wrapper verifies Gradle 9.7.1 against its committed distribution SHA-256.
RUN --mount=type=cache,id=otis-opensaml-gradle,target=/root/.gradle \
    java -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain \
      --no-daemon --max-workers=2 -Dorg.gradle.jvmargs=-Xmx1536m \
      -Dopensearch.version=3.9.0 -Dbuild.snapshot=false \
      -I /tmp/rebuild/opensaml-dependencies.init.gradle :libs:opensaml:shadowJar \
    && python3 /tmp/rebuild/verify_opensaml_rebuild.py \
      /usr/share/opensearch/plugins/opensearch-security/opensaml-3.9.0.0-all.jar \
      /build/libs/opensaml/build/libs/opensaml-3.9.0.0-all.jar \
      /tmp/rebuild/dependencies.lock.json /root/.gradle/caches/modules-2/files-2.1

FROM opensearchproject/opensearch:3.9.0@sha256:3b55f6b6249cfdb92b52ee59adc8a266203ba9ef9f5d82544fad6f1af2f3609e
ARG TARGETARCH
# These package versions address the two Amazon Linux findings in the ARM64 scan.
USER 0
RUN dnf install -y --releasever=latest \
      ca-certificates-2025.2.76-1.0.amzn2023.0.5 \
      libxml2-2.10.4-1.amzn2023.0.22 \
    && dnf clean all
COPY opensearch/patch_dependencies.py opensearch/dependencies.lock.json /tmp/dependency-patches/
RUN python3 /tmp/dependency-patches/patch_dependencies.py /usr/share/opensearch /tmp/dependency-patches/dependencies.lock.json \
    && rm -rf /tmp/dependency-patches
COPY --from=opensaml-build /build/libs/opensaml/build/libs/opensaml-3.9.0.0-all.jar /usr/share/opensearch/plugins/opensearch-security/opensaml-3.9.0.0-all.jar
USER opensearch
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
