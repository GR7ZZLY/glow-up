const express = require("express");
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const app = express();

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

function requiereApiKey(req, res, next) {
    if (!process.env.ADMIN_API_KEY) {
        console.error("ADMIN_API_KEY no está configurada");
        return res.sendStatus(401);
    }

    const header = req.headers["x-api-key"];

    if (!header) {
        return res.sendStatus(401);
    }

    const bufferRecibido = Buffer.from(header);
    const bufferEsperado = Buffer.from(process.env.ADMIN_API_KEY);

    if (bufferRecibido.length !== bufferEsperado.length) {
        return res.sendStatus(401);
    }

    if (!crypto.timingSafeEqual(bufferRecibido, bufferEsperado)) {
        return res.sendStatus(401);
    }

    next();
}

app.use((req, res, next) => {
    if (req.path === "/" || req.path === "/webhook") {
        return next();
    }
    requiereApiKey(req, res, next);
});

const PORT = process.env.PORT || 3000;
const HORAS_ENTRE_RESPUESTAS_BOT = 24;

async function resolverClientePorTelefono(telefono) {
    const { data: cliente, error: errorBusqueda } = await supabase
        .from("clientes")
        .select("*")
        .eq("telefono", telefono)
        .maybeSingle();

    if (errorBusqueda) {
        throw errorBusqueda;
    }

    if (cliente) {
        return cliente;
    }

    const { data: creado, error: errorCreacion } = await supabase
        .from("clientes")
        .insert({ telefono, nombre: "Pendiente de nombre", activo: true })
        .select()
        .single();

    if (errorCreacion) {
        if (errorCreacion.code === "23505") {
            const { data: existente, error: errorReintento } = await supabase
                .from("clientes")
                .select("*")
                .eq("telefono", telefono)
                .maybeSingle();

            if (errorReintento) {
                throw errorReintento;
            }

            return existente;
        }

        throw errorCreacion;
    }

    return creado;
}

async function resolverConversacionActiva(cliente_id) {
    const { data: activas, error } = await supabase
        .from("conversaciones")
        .select("*")
        .eq("cliente_id", cliente_id)
        .in("estado", ["BOT_ACTIVO", "ATENCION_HUMANA"]);

    if (error) {
        throw error;
    }

    if (activas.length === 0) {
        return null;
    }

    if (activas.length > 1) {
        throw new Error(
            `El cliente ${cliente_id} tiene ${activas.length} conversaciones activas simultáneas`
        );
    }

    return activas[0];
}

async function resolverClienteYConversacion(telefono) {
    const cliente = await resolverClientePorTelefono(telefono);
    const conversacion = await resolverConversacionActiva(cliente.id);

    return {
        cliente,
        conversacion
    };
}

async function crearConversacion(cliente_id) {
    const { data: cliente, error: errorCliente } = await supabase
        .from("clientes")
        .select("id")
        .eq("id", cliente_id)
        .maybeSingle();

    if (errorCliente) {
        throw errorCliente;
    }

    if (!cliente) {
        throw new Error(`El cliente ${cliente_id} no existe`);
    }

    const { data: creada, error: errorCreacion } = await supabase
        .from("conversaciones")
        .insert({ cliente_id })
        .select()
        .single();

    if (errorCreacion) {
        throw errorCreacion;
    }

    return creada;
}

async function resolverOCrearConversacion(telefono) {
    const { cliente, conversacion } = await resolverClienteYConversacion(telefono);

    if (conversacion) {
        return { cliente, conversacion };
    }

    try {
        const creada = await crearConversacion(cliente.id);
        return { cliente, conversacion: creada };
    } catch (errorCreacion) {
        if (errorCreacion.code === "23505") {
            const conversacionExistente = await resolverConversacionActiva(cliente.id);
            return { cliente, conversacion: conversacionExistente };
        }

        throw errorCreacion;
    }
}

async function guardarMensaje(conversacion_id, remitente, contenido, whatsapp_message_id = null) {
    const { data: creado, error } = await supabase
        .from("mensajes")
        .insert({ conversacion_id, remitente, contenido, whatsapp_message_id })
        .select()
        .single();

    if (error) {
        throw error;
    }

    return creado;
}

async function enviarMensajeWhatsApp(telefono, texto) {
    const url = `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const respuesta = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to: telefono,
            type: "text",
            text: { body: texto }
        })
    });

    const json = await respuesta.json();

    if (!respuesta.ok) {
        throw new Error(`Error al enviar mensaje de WhatsApp: ${JSON.stringify(json)}`);
    }

    return json;
}

async function botRespondioRecientemente(conversacion_id) {
    const { data, error } = await supabase
        .from("mensajes")
        .select("creado_en")
        .eq("conversacion_id", conversacion_id)
        .eq("remitente", "BOT")
        .order("creado_en", { ascending: false })
        .limit(1);

    if (error) {
        throw error;
    }

    if (data.length === 0) {
        return false;
    }

    const ultimaRespuesta = new Date(data[0].creado_en);
    const horasTranscurridas = (Date.now() - ultimaRespuesta.getTime()) / (1000 * 60 * 60);

    return horasTranscurridas < HORAS_ENTRE_RESPUESTAS_BOT;
}

async function procesarMensajeEntrante(telefono, contenido, whatsapp_message_id = null) {
    const cliente = await resolverClientePorTelefono(telefono);
    let conversacion = await resolverConversacionActiva(cliente.id);

    if (!conversacion) {
        try {
            conversacion = await crearConversacion(cliente.id);
        } catch (errorCreacion) {
            if (errorCreacion.code === "23505") {
                conversacion = await resolverConversacionActiva(cliente.id);
            } else {
                throw errorCreacion;
            }
        }
    }

    let mensaje;
    try {
        mensaje = await guardarMensaje(conversacion.id, "CLIENTE", contenido, whatsapp_message_id);
    } catch (errorMensaje) {
        if (errorMensaje.code === "23505") {
            console.log("Mensaje duplicado ignorado");
            mensaje = null;
        } else {
            throw errorMensaje;
        }
    }

    return {
        cliente,
        conversacion,
        mensaje
    };
}


app.get("/", (req, res) => {
    res.send("Glow Up está funcionando 💜");
});

app.get("/servicios", async (req, res) => {
    const { data, error } = await supabase
        .from("servicios")
        .select("*");

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener los servicios",
            error: error.message
        });
    }

    res.json(data);
});

app.get("/servicios/:nombre", async (req, res) => {
    const buscado = req.params.nombre;

    const { data, error } = await supabase
        .from("servicios")
        .select("*")
        .ilike("nombre", buscado);

    if (error) {
        return res.status(500).json({
            mensaje: "Error al buscar el servicio",
            error: error.message
        });
    }

    if (data.length === 0) {
        return res.status(404).json({ mensaje: "Servicio no encontrado" });
    }

    if (data.length > 1) {
        return res.status(409).json({
            mensaje: "Hay varios servicios con ese nombre",
            servicios: data
        });
    }

    res.json(data[0]);
});

app.post("/servicios", async (req, res) => {
    const { nombre, categoria, precio, tipo_precio } = req.body;

    if (!nombre || !categoria || !precio || !tipo_precio) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios: nombre, categoria, precio, tipo_precio" });
    }

    if (tipo_precio !== "FIJO" && tipo_precio !== "DESDE") {
        return res.status(400).json({ mensaje: "tipo_precio debe ser FIJO o DESDE" });
    }

    const { data: existentes, error: errorConsulta } = await supabase
        .from("servicios")
        .select("*")
        .ilike("nombre", nombre)
        .ilike("categoria", categoria);

    if (errorConsulta) {
        return res.status(500).json({
            mensaje: "Error al comprobar el servicio",
            error: errorConsulta.message
        });
    }

    if (existentes.length > 0) {
        return res.status(400).json({ mensaje: "El servicio ya existe en esa categoría" });
    }

    const { data: creado, error: errorInsercion } = await supabase
        .from("servicios")
        .insert({ nombre, categoria, precio, tipo_precio })
        .select()
        .single();

    if (errorInsercion) {
        return res.status(500).json({
            mensaje: "Error al crear el servicio",
            error: errorInsercion.message
        });
    }

    res.status(201).json(creado);
});

app.delete("/servicios/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data: existentes, error: errorConsulta } = await supabase
        .from("servicios")
        .select("*")
        .eq("id", id);

    if (errorConsulta) {
        return res.status(500).json({
            mensaje: "Error al eliminar el servicio",
            error: errorConsulta.message
        });
    }

    if (existentes.length === 0) {
        return res.status(404).json({ mensaje: "Servicio no encontrado" });
    }

    const { data: eliminados, error: errorEliminacion } = await supabase
        .from("servicios")
        .delete()
        .eq("id", id)
        .select();

    if (errorEliminacion) {
        return res.status(500).json({
            mensaje: "Error al eliminar el servicio",
            error: errorEliminacion.message
        });
    }

    if (eliminados.length === 0) {
        return res.status(404).json({ mensaje: "El servicio no pudo ser eliminado" });
    }

    res.status(200).json({
        mensaje: "Servicio eliminado correctamente",
        servicio: eliminados[0]
    });
});

app.patch("/servicios/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data: existente, error: errorConsulta } = await supabase
        .from("servicios")
        .select("*")
        .eq("id", id);

    if (errorConsulta) {
        return res.status(500).json({
            mensaje: "Error al actualizar el servicio",
            error: errorConsulta.message
        });
    }

    if (existente.length === 0) {
        return res.status(404).json({ mensaje: "Servicio no encontrado" });
    }

    const { nombre, categoria, precio, tipo_precio, activo } = req.body;
    const cambios = {};

    if (nombre !== undefined) cambios.nombre = nombre;
    if (categoria !== undefined) cambios.categoria = categoria;
    if (precio !== undefined) cambios.precio = precio;
    if (tipo_precio !== undefined) cambios.tipo_precio = tipo_precio;
    if (activo !== undefined) cambios.activo = activo;

    if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ mensaje: "No hay campos para actualizar" });
    }

    if (cambios.nombre !== undefined && (typeof cambios.nombre !== "string" || cambios.nombre.trim() === "")) {
        return res.status(400).json({ mensaje: "nombre no puede estar vacío" });
    }

    if (cambios.categoria !== undefined && (typeof cambios.categoria !== "string" || cambios.categoria.trim() === "")) {
        return res.status(400).json({ mensaje: "categoria no puede estar vacía" });
    }

    if (cambios.precio !== undefined && (typeof cambios.precio !== "number" || isNaN(cambios.precio) || cambios.precio <= 0)) {
        return res.status(400).json({ mensaje: "precio debe ser un número mayor que 0" });
    }

    if (cambios.tipo_precio !== undefined && cambios.tipo_precio !== "FIJO" && cambios.tipo_precio !== "DESDE") {
        return res.status(400).json({ mensaje: "tipo_precio debe ser FIJO o DESDE" });
    }

    if (cambios.activo !== undefined && typeof cambios.activo !== "boolean") {
        return res.status(400).json({ mensaje: "activo debe ser true o false" });
    }

    if (cambios.nombre !== undefined || cambios.categoria !== undefined) {
        const nombreFinal = cambios.nombre !== undefined ? cambios.nombre : existente[0].nombre;
        const categoriaFinal = cambios.categoria !== undefined ? cambios.categoria : existente[0].categoria;

        const { data: duplicados, error: errorDuplicado } = await supabase
            .from("servicios")
            .select("*")
            .ilike("nombre", nombreFinal)
            .ilike("categoria", categoriaFinal)
            .neq("id", id);

        if (errorDuplicado) {
            return res.status(500).json({
                mensaje: "Error al actualizar el servicio",
                error: errorDuplicado.message
            });
        }

        if (duplicados.length > 0) {
            return res.status(400).json({ mensaje: "El servicio ya existe en esa categoría" });
        }
    }

    const { data: actualizado, error: errorActualizacion } = await supabase
        .from("servicios")
        .update(cambios)
        .eq("id", id)
        .select()
        .single();

    if (errorActualizacion) {
        return res.status(500).json({
            mensaje: "Error al actualizar el servicio",
            error: errorActualizacion.message
        });
    }

    res.status(200).json({
        mensaje: "Servicio actualizado correctamente",
        servicio: actualizado
    });
});

app.get("/clientes", async (req, res) => {
    const { data, error } = await supabase
        .from("clientes")
        .select("*");

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener los clientes",
            error: error.message
        });
    }

    res.json(data);
});

app.get("/conversaciones", async (req, res) => {
    const { data, error } = await supabase
        .from("conversaciones")
        .select("*");

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener las conversaciones",
            error: error.message
        });
    }

    res.json(data);
});

app.get("/conversaciones/:id", async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
        .from("conversaciones")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener la conversación",
            error: error.message
        });
    }

    if (!data) {
        return res.status(404).json({
            mensaje: "Conversación no encontrada"
        });
    }

    res.json(data);
});

app.patch("/conversaciones/:id", async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body;

    if (!estado) {
        return res.status(400).json({
            mensaje: "Falta el campo obligatorio: estado"
        });
    }

    const estadosPermitidos = [
        "BOT_ACTIVO",
        "ATENCION_HUMANA",
        "CERRADA"
    ];

    if (!estadosPermitidos.includes(estado)) {
        return res.status(400).json({
            mensaje: "Estado no válido"
        });
    }

    const { data: conversacion, error: errorConversacion } = await supabase
        .from("conversaciones")
        .select("id")
        .eq("id", id)
        .maybeSingle();

    if (errorConversacion) {
        return res.status(500).json({
            mensaje: "Error al verificar la conversación",
            error: errorConversacion.message
        });
    }

    if (!conversacion) {
        return res.status(404).json({
            mensaje: "Conversación no encontrada"
        });
    }

    const { data: actualizada, error } = await supabase
        .from("conversaciones")
        .update({ estado })
        .eq("id", id)
        .select()
        .single();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al actualizar la conversación",
            error: error.message
        });
    }

    res.json(actualizada);
});

app.get("/mensajes", async (req, res) => {
    const { data, error } = await supabase
        .from("mensajes")
        .select("*");

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener los mensajes",
            error: error.message
        });
    }

    res.json(data);
});

app.get("/conversaciones/:id/mensajes", async (req, res) => {
    const { id } = req.params;

    const { data: conversacion, error: errorConversacion } = await supabase
        .from("conversaciones")
        .select("id")
        .eq("id", id)
        .maybeSingle();

    if (errorConversacion) {
        return res.status(500).json({
            mensaje: "Error al verificar la conversación",
            error: errorConversacion.message
        });
    }

    if (!conversacion) {
        return res.status(404).json({
            mensaje: "Conversación no encontrada"
        });
    }

    const { data, error } = await supabase
        .from("mensajes")
        .select("*")
        .eq("conversacion_id", id);

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener los mensajes de la conversación",
            error: error.message
        });
    }

    res.json(data);
});

app.get("/conversaciones/:id/completa", async (req, res) => {
    const { id } = req.params;

    const { data: conversacion, error: errorConversacion } = await supabase
        .from("conversaciones")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (errorConversacion) {
        return res.status(500).json({
            mensaje: "Error al obtener la conversación",
            error: errorConversacion.message
        });
    }

    if (!conversacion) {
        return res.status(404).json({
            mensaje: "Conversación no encontrada"
        });
    }

    const { data: cliente, error: errorCliente } = await supabase
        .from("clientes")
        .select("*")
        .eq("id", conversacion.cliente_id)
        .maybeSingle();

    if (errorCliente) {
        return res.status(500).json({
            mensaje: "Error al obtener el cliente",
            error: errorCliente.message
        });
    }

    const { data: mensajes, error: errorMensajes } = await supabase
        .from("mensajes")
        .select("*")
        .eq("conversacion_id", id)
        .order("creado_en", { ascending: true });

    if (errorMensajes) {
        return res.status(500).json({
            mensaje: "Error al obtener los mensajes",
            error: errorMensajes.message
        });
    }

    res.json({
        conversacion,
        cliente,
        mensajes
    });
});

app.post("/mensajes", async (req, res) => {
    const { conversacion_id, remitente, contenido } = req.body;

    if (!conversacion_id || !remitente || !contenido) {
        return res.status(400).json({
            mensaje: "Faltan campos obligatorios: conversacion_id, remitente, contenido"
        });
    }

    const { data: conversacion, error: errorConversacion } = await supabase
        .from("conversaciones")
        .select("id")
        .eq("id", conversacion_id)
        .maybeSingle();

    if (errorConversacion) {
        return res.status(500).json({
            mensaje: "Error al verificar la conversación",
            error: errorConversacion.message
        });
    }

    if (!conversacion) {
        return res.status(404).json({
            mensaje: "Conversación no encontrada"
        });
    }

    const { data: creado, error } = await supabase
        .from("mensajes")
        .insert({
            conversacion_id,
            remitente,
            contenido
        })
        .select()
        .single();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al crear el mensaje",
            error: error.message
        });
    }

    res.status(201).json(creado);
});

app.post("/conversaciones", async (req, res) => {
    const { cliente_id } = req.body;

    if (!cliente_id) {
        return res.status(400).json({
            mensaje: "Falta el campo obligatorio: cliente_id"
        });
    }

    const { data: cliente, error: errorCliente } = await supabase
        .from("clientes")
        .select("id")
        .eq("id", cliente_id)
        .maybeSingle();

    if (errorCliente) {
        return res.status(500).json({
            mensaje: "Error al verificar el cliente",
            error: errorCliente.message
        });
    }

    if (!cliente) {
        return res.status(404).json({
            mensaje: "Cliente no encontrado"
        });
    }

    const { data: creada, error } = await supabase
        .from("conversaciones")
        .insert({
            cliente_id: cliente_id
        })
        .select()
        .single();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al crear la conversación",
            error: error.message
        });
    }

    res.status(201).json(creada);
});

app.post("/clientes", async (req, res) => {
    const { nombre, telefono } = req.body;

    if (!nombre || !telefono) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios: nombre, telefono" });
    }

    const { data: creado, error } = await supabase
        .from("clientes")
        .insert({ nombre, telefono })
        .select()
        .single();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al crear el cliente",
            error: error.message
        });
    }

    res.status(201).json(creado);
});

app.get("/clientes/telefono/:telefono", async (req, res) => {
    const telefono = req.params.telefono;

    const { data: cliente, error } = await supabase
        .from("clientes")
        .select("*")
        .eq("telefono", telefono)
        .maybeSingle();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al buscar el cliente",
            error: error.message
        });
    }

    if (!cliente) {
        return res.status(404).json({ mensaje: "Cliente no encontrado" });
    }

    res.json(cliente);
});

app.patch("/clientes/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data: existente, error: errorConsulta } = await supabase
        .from("clientes")
        .select("*")
        .eq("id", id);

    if (errorConsulta) {
        return res.status(500).json({
            mensaje: "Error al actualizar el cliente",
            error: errorConsulta.message
        });
    }

    if (existente.length === 0) {
        return res.status(404).json({ mensaje: "Cliente no encontrado" });
    }

    const { nombre, telefono, activo } = req.body;
    const cambios = {};

    if (nombre !== undefined) cambios.nombre = nombre;
    if (telefono !== undefined) cambios.telefono = telefono;
    if (activo !== undefined) cambios.activo = activo;

    if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ mensaje: "No hay campos para actualizar" });
    }

    if (cambios.nombre !== undefined && (typeof cambios.nombre !== "string" || cambios.nombre.trim() === "")) {
        return res.status(400).json({ mensaje: "nombre no puede estar vacío" });
    }

    if (cambios.telefono !== undefined && (typeof cambios.telefono !== "string" || cambios.telefono.trim() === "")) {
        return res.status(400).json({ mensaje: "telefono no puede estar vacío" });
    }

    if (cambios.activo !== undefined && typeof cambios.activo !== "boolean") {
        return res.status(400).json({ mensaje: "activo debe ser true o false" });
    }

    const { data: actualizado, error: errorActualizacion } = await supabase
        .from("clientes")
        .update(cambios)
        .eq("id", id)
        .select()
        .single();

    if (errorActualizacion) {
        return res.status(500).json({
            mensaje: "Error al actualizar el cliente",
            error: errorActualizacion.message
        });
    }

    res.status(200).json({
        mensaje: "Cliente actualizado correctamente",
        cliente: actualizado
    });
});

app.delete("/clientes/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data: existente, error: errorConsulta } = await supabase
        .from("clientes")
        .select("*")
        .eq("id", id);

    if (errorConsulta) {
        return res.status(500).json({
            mensaje: "Error al eliminar el cliente",
            error: errorConsulta.message
        });
    }

    if (existente.length === 0) {
        return res.status(404).json({ mensaje: "Cliente no encontrado" });
    }

    const { data: eliminados, error: errorEliminacion } = await supabase
        .from("clientes")
        .delete()
        .eq("id", id)
        .select();

    if (errorEliminacion) {
        return res.status(500).json({
            mensaje: "Error al eliminar el cliente",
            error: errorEliminacion.message
        });
    }

    if (eliminados.length === 0) {
        return res.status(404).json({ mensaje: "El cliente no pudo ser eliminado" });
    }

    res.status(200).json({
        mensaje: "Cliente eliminado correctamente",
        cliente: eliminados[0]
    });
});

app.get("/clientes/:id/citas", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID del cliente debe ser numérico" });
    }

    const { data: cliente, error: errorCliente } = await supabase
        .from("clientes")
        .select("id")
        .eq("id", id)
        .maybeSingle();

    if (errorCliente) {
        return res.status(500).json({
            mensaje: "Error al verificar el cliente",
            error: errorCliente.message
        });
    }

    if (!cliente) {
        return res.status(404).json({ mensaje: "Cliente no encontrado" });
    }

    const { data: citas, error: errorCitas } = await supabase
        .from("citas")
        .select("*")
        .eq("cliente_id", id);

    if (errorCitas) {
        return res.status(500).json({
            mensaje: "Error al obtener las citas del cliente",
            error: errorCitas.message
        });
    }

    res.json(citas);
});

app.get("/clientes/:id/conversaciones", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID del cliente debe ser numérico" });
    }

    const { data: cliente, error: errorCliente } = await supabase
        .from("clientes")
        .select("id")
        .eq("id", id)
        .maybeSingle();

    if (errorCliente) {
        return res.status(500).json({
            mensaje: "Error al verificar el cliente",
            error: errorCliente.message
        });
    }

    if (!cliente) {
        return res.status(404).json({ mensaje: "Cliente no encontrado" });
    }

    const { data: conversaciones, error: errorConversaciones } = await supabase
        .from("conversaciones")
        .select("*")
        .eq("cliente_id", id);

    if (errorConversaciones) {
        return res.status(500).json({
            mensaje: "Error al obtener las conversaciones del cliente",
            error: errorConversaciones.message
        });
    }

    res.json(conversaciones);
});

app.get("/citas", async (req, res) => {
    const { data, error } = await supabase
        .from("citas")
        .select("*");

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener las citas",
            error: error.message
        });
    }

    res.json(data);
});

app.post("/citas", async (req, res) => {
    const { cliente_id, fecha, hora, estado } = req.body;

    if (!cliente_id || !fecha || !hora) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios: cliente_id, fecha, hora" });
    }

    const estadosPermitidos = ["PENDIENTE", "CONFIRMADA", "CANCELADA", "COMPLETADA"];

    if (estado !== undefined && !estadosPermitidos.includes(estado)) {
        return res.status(400).json({ mensaje: "Estado no válido" });
    }

    const { data: cliente, error: errorCliente } = await supabase
        .from("clientes")
        .select("id")
        .eq("id", cliente_id)
        .maybeSingle();

    if (errorCliente) {
        return res.status(500).json({
            mensaje: "Error al verificar el cliente",
            error: errorCliente.message
        });
    }

    if (!cliente) {
        return res.status(404).json({ mensaje: "Cliente no encontrado" });
    }

    const nuevaCita = { cliente_id, fecha, hora };

    if (estado !== undefined) {
        nuevaCita.estado = estado;
    }

    const { data: creada, error } = await supabase
        .from("citas")
        .insert(nuevaCita)
        .select()
        .single();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al crear la cita",
            error: error.message
        });
    }

    res.status(201).json(creada);
});

app.get("/citas/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data, error } = await supabase
        .from("citas")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener la cita",
            error: error.message
        });
    }

    if (!data) {
        return res.status(404).json({ mensaje: "Cita no encontrada" });
    }

    res.json(data);
});

app.get("/citas/fecha/:fecha", async (req, res) => {
    const fecha = req.params.fecha;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ mensaje: "La fecha debe tener el formato YYYY-MM-DD" });
    }

    const { data: citas, error } = await supabase
        .from("citas")
        .select("*")
        .eq("fecha", fecha);

    if (error) {
        return res.status(500).json({
            mensaje: "Error al obtener las citas de la fecha",
            error: error.message
        });
    }

    res.json(citas);
});

app.patch("/citas/:id", async (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { estado } = req.body;

    if (!estado) {
        return res.status(400).json({ mensaje: "Falta el campo obligatorio: estado" });
    }

    const estadosPermitidos = ["PENDIENTE", "CONFIRMADA", "CANCELADA", "COMPLETADA"];

    if (!estadosPermitidos.includes(estado)) {
        return res.status(400).json({ mensaje: "Estado no válido" });
    }

    const { data: existente, error: errorConsulta } = await supabase
        .from("citas")
        .select("id")
        .eq("id", id)
        .maybeSingle();

    if (errorConsulta) {
        return res.status(500).json({
            mensaje: "Error al verificar la cita",
            error: errorConsulta.message
        });
    }

    if (!existente) {
        return res.status(404).json({ mensaje: "Cita no encontrada" });
    }

    const { data: actualizada, error } = await supabase
        .from("citas")
        .update({ estado })
        .eq("id", id)
        .select()
        .single();

    if (error) {
        return res.status(500).json({
            mensaje: "Error al actualizar la cita",
            error: error.message
        });
    }

    res.json(actualizada);
});

app.post("/citas/:id/servicios", async (req, res) => {
    const cita_id = Number(req.params.id);

    if (isNaN(cita_id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const servicio_id = Number(req.body.servicio_id);

    if (!req.body.servicio_id || isNaN(servicio_id)) {
        return res.status(400).json({ mensaje: "servicio_id debe ser un número" });
    }

    const { data: cita, error: errorCita } = await supabase
        .from("citas")
        .select("id")
        .eq("id", cita_id)
        .maybeSingle();

    if (errorCita) {
        return res.status(500).json({
            mensaje: "Error al verificar la cita",
            error: errorCita.message
        });
    }

    if (!cita) {
        return res.status(404).json({ mensaje: "Cita no encontrada" });
    }

    const { data: servicio, error: errorServicio } = await supabase
        .from("servicios")
        .select("id")
        .eq("id", servicio_id)
        .maybeSingle();

    if (errorServicio) {
        return res.status(500).json({
            mensaje: "Error al verificar el servicio",
            error: errorServicio.message
        });
    }

    if (!servicio) {
        return res.status(404).json({ mensaje: "Servicio no encontrado" });
    }

    const { data: creada, error } = await supabase
        .from("cita_servicios")
        .insert({ cita_id, servicio_id })
        .select()
        .single();

    if (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                mensaje: "El servicio ya está asociado a esta cita"
            });
        }

        return res.status(500).json({
            mensaje: "Error al asociar el servicio a la cita",
            error: error.message
        });
    }

    res.status(201).json(creada);
});

app.get("/citas/:id/servicios", async (req, res) => {
    const cita_id = Number(req.params.id);

    if (isNaN(cita_id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data: cita, error: errorCita } = await supabase
        .from("citas")
        .select("id")
        .eq("id", cita_id)
        .maybeSingle();

    if (errorCita) {
        return res.status(500).json({
            mensaje: "Error al verificar la cita",
            error: errorCita.message
        });
    }

    if (!cita) {
        return res.status(404).json({ mensaje: "Cita no encontrada" });
    }

    const { data: relaciones, error: errorRelaciones } = await supabase
        .from("cita_servicios")
        .select("*")
        .eq("cita_id", cita_id);

    if (errorRelaciones) {
        return res.status(500).json({
            mensaje: "Error al obtener los servicios de la cita",
            error: errorRelaciones.message
        });
    }

    if (relaciones.length === 0) {
        return res.json([]);
    }

    const idsServicios = relaciones.map((relacion) => relacion.servicio_id);

    const { data: servicios, error: errorServicios } = await supabase
        .from("servicios")
        .select("*")
        .in("id", idsServicios);

    if (errorServicios) {
        return res.status(500).json({
            mensaje: "Error al obtener los servicios de la cita",
            error: errorServicios.message
        });
    }

    const resultado = relaciones.map((relacion) => ({
        ...relacion,
        servicio: servicios.find((s) => s.id === relacion.servicio_id)
    }));

    res.json(resultado);
});

app.delete("/citas/:id/servicios/:servicio_id", async (req, res) => {
    const cita_id = Number(req.params.id);
    const servicio_id = Number(req.params.servicio_id);

    if (isNaN(cita_id) || isNaN(servicio_id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data: cita, error: errorCita } = await supabase
        .from("citas")
        .select("id")
        .eq("id", cita_id)
        .maybeSingle();

    if (errorCita) {
        return res.status(500).json({
            mensaje: "Error al verificar la cita",
            error: errorCita.message
        });
    }

    if (!cita) {
        return res.status(404).json({ mensaje: "Cita no encontrada" });
    }

    const { data: relacion, error: errorRelacion } = await supabase
        .from("cita_servicios")
        .select("*")
        .eq("cita_id", cita_id)
        .eq("servicio_id", servicio_id)
        .maybeSingle();

    if (errorRelacion) {
        return res.status(500).json({
            mensaje: "Error al verificar el servicio de la cita",
            error: errorRelacion.message
        });
    }

    if (!relacion) {
        return res.status(404).json({ mensaje: "El servicio no está asociado a esta cita" });
    }

    const { error } = await supabase
        .from("cita_servicios")
        .delete()
        .eq("cita_id", cita_id)
        .eq("servicio_id", servicio_id);

    if (error) {
        return res.status(500).json({
            mensaje: "Error al eliminar el servicio de la cita",
            error: error.message
        });
    }

    res.json({ mensaje: "Servicio eliminado de la cita" });
});

app.get("/citas/:id/completa", async (req, res) => {
    const cita_id = Number(req.params.id);

    if (isNaN(cita_id)) {
        return res.status(400).json({ mensaje: "El ID debe ser un número" });
    }

    const { data: cita, error: errorCita } = await supabase
        .from("citas")
        .select("*")
        .eq("id", cita_id)
        .maybeSingle();

    if (errorCita) {
        return res.status(500).json({
            mensaje: "Error al verificar la cita",
            error: errorCita.message
        });
    }

    if (!cita) {
        return res.status(404).json({ mensaje: "Cita no encontrada" });
    }

    const { data: cliente, error: errorCliente } = await supabase
        .from("clientes")
        .select("*")
        .eq("id", cita.cliente_id)
        .maybeSingle();

    if (errorCliente) {
        return res.status(500).json({
            mensaje: "Error al verificar el cliente",
            error: errorCliente.message
        });
    }

    if (!cliente) {
        return res.status(404).json({ mensaje: "Cliente no encontrado" });
    }

    const { data: relaciones, error: errorRelaciones } = await supabase
        .from("cita_servicios")
        .select("*")
        .eq("cita_id", cita_id);

    if (errorRelaciones) {
        return res.status(500).json({
            mensaje: "Error al obtener los servicios de la cita",
            error: errorRelaciones.message
        });
    }

    if (relaciones.length === 0) {
        return res.json({ cita, cliente, servicios: [] });
    }

    const idsServicios = relaciones.map((relacion) => relacion.servicio_id);

    const { data: servicios, error: errorServicios } = await supabase
        .from("servicios")
        .select("*")
        .in("id", idsServicios);

    if (errorServicios) {
        return res.status(500).json({
            mensaje: "Error al obtener los servicios de la cita",
            error: errorServicios.message
        });
    }

    res.json({ cita, cliente, servicios });
});

app.post("/test/mensaje-entrante", async (req, res) => {
    const { telefono, contenido } = req.body;

    if (!telefono || !contenido) {
        return res.status(400).json({ mensaje: "Faltan campos obligatorios: telefono, contenido" });
    }

    try {
        const { cliente, conversacion, mensaje: mensajeCliente } = await procesarMensajeEntrante(telefono, contenido);
        const mensajeBot = await guardarMensaje(conversacion.id, "BOT", "Hola, en un momento te atendemos.");

        res.status(201).json({
            cliente,
            conversacion,
            mensajeCliente,
            mensajeBot
        });
    } catch (error) {
        res.status(500).json({
            mensaje: "Error al procesar el mensaje entrante",
            error: error.message
        });
    }
});

function firmaValida(req) {
    const header = req.headers["x-hub-signature-256"];

    if (!header || !req.rawBody || !process.env.META_APP_SECRET) {
        if (!process.env.META_APP_SECRET) {
            console.error("META_APP_SECRET no está configurado");
        }
        return false;
    }

    const firmaEsperada = "sha256=" + crypto
        .createHmac("sha256", process.env.META_APP_SECRET)
        .update(req.rawBody)
        .digest("hex");

    const bufferRecibido = Buffer.from(header);
    const bufferEsperado = Buffer.from(firmaEsperada);

    if (bufferRecibido.length !== bufferEsperado.length) {
        return false;
    }

    return crypto.timingSafeEqual(bufferRecibido, bufferEsperado);
}

app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }

    res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
    if (!firmaValida(req)) {
        console.warn("Firma inválida en /webhook");
        return res.sendStatus(401);
    }

    try {
        const value = req.body?.entry?.[0]?.changes?.[0]?.value;
        const mensajes = value?.messages;

        if (!mensajes || mensajes.length === 0) {
            return res.sendStatus(200);
        }

        const mensaje = mensajes[0];

        if (mensaje.type !== "text") {
            return res.sendStatus(200);
        }

        const telefono = mensaje.from;
        const contenido = mensaje.text.body;
        const whatsappMessageId = mensaje.id;

        if (whatsappMessageId) {
            const { data: existente, error: errorExistente } = await supabase
                .from("mensajes")
                .select("id")
                .eq("whatsapp_message_id", whatsappMessageId)
                .maybeSingle();

            if (errorExistente) {
                throw errorExistente;
            }

            if (existente) {
                console.log("Mensaje duplicado ignorado");
                return res.sendStatus(200);
            }
        }

        const { conversacion, mensaje: mensajeGuardado } = await procesarMensajeEntrante(telefono, contenido, whatsappMessageId);

        if (mensajeGuardado && conversacion.estado === "BOT_ACTIVO") {
            try {
                if (await botRespondioRecientemente(conversacion.id)) {
                    console.log("Respuesta automática omitida: el bot ya respondió recientemente en esta conversación");
                } else {
                    await enviarMensajeWhatsApp(telefono, "Hola, en un momento te atendemos.");
                    await guardarMensaje(conversacion.id, "BOT", "Hola, en un momento te atendemos.");
                }
            } catch (errorEnvio) {
                console.error("Error enviando respuesta automática de WhatsApp:", errorEnvio);
            }
        }
    } catch (error) {
        console.error("Error procesando mensaje entrante de WhatsApp:", error);
    }

    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Servidor funcionando en http://localhost:${PORT}`);
});