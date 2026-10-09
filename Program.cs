using ControlTower.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Each module registers its own services (see Modules/<Module>/<Module>Module.cs); all of them
// read their settings from appsettings.json.
builder.Services.AddReportsModule();
builder.Services.AddFireHydrantModule();
builder.Services.AddGasLeakModule();
builder.Services.AddEmsModule();
builder.Services.AddEbRtmModule();

// Enable CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll",
        builder =>
        {
            builder.AllowAnyOrigin()
                   .AllowAnyMethod()
                   .AllowAnyHeader();
        });
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowAll");

app.UseDefaultFiles(); // Serve index.html by default
// Serve files from wwwroot. no-cache = browsers revalidate (cheap 304 via ETag) instead of running a
// stale app.js / css after a deploy.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});

app.UseAuthorization();

app.MapControllers();

app.Run();
